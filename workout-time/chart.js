// chart.js - Chart management and visualization

class ChartManager {
  constructor(containerId) {
    this.containerId = containerId;
    this.chart = null;
    this.container = null;
    this.loadHistory = [];
    this.maxHistoryPoints = 72000; // 2hrs at 100ms polling (7200s / 0.1s = 72000 points)
    this.currentTimeRange = 30; // Current time range in seconds (default 30s)
    this.live = true;
    this.onLog = null; // Callback for logging
    this.updateInterval = null; // Interval handle for periodic updates
    this.updateFrequency = 10; // Update chart every 10ms
    this.chartHeight = 300;
    this.loadUnit = {
      label: "kg",
      decimals: 1,
      toDisplay: (value) => value,
    };
    this.eventMarkers = []; // Array of {time: Date, label: string, color: string}
    this.resizeObserver = null;
    this._handleWindowResize = null;
    this.averageLoadLines = null; // Store average load lines: { averageTotal, averageLeft, averageRight, warmupEndTime, endTime }
  }

  // Initialize uPlot chart
  init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.warn("Chart container not found yet, will initialize later");
      return false;
    }

    this.container = container;

    // uPlot expects data in this format: [timestamps, series1, series2, ...]
    const data = [
      [], // timestamps (Unix time in seconds)
      [], // Total Load
      [], // Left Cable Load (B)
      [], // Right Cable Load (A)
      [], // Left Cable Position (B)
      [], // Right Cable Position (A)
      [], // Average Total Load (constant line)
      [], // Average Left Load (constant line)
      [], // Average Right Load (constant line)
    ];

    const manager = this;

    // Plugin to draw event markers
    const eventMarkersPlugin = {
      hooks: {
        draw: [
          (u) => {
            const { ctx } = u;
            const { left, top, width, height } = u.bbox;

            ctx.save();

            // Draw each event marker
            manager.eventMarkers.forEach((marker) => {
              const markerTime = marker.time.getTime() / 1000; // Convert to Unix seconds
              const x = u.valToPos(markerTime, "x", true);

              // Only draw if marker is within visible range
              if (x >= left && x <= left + width) {
                // Draw vertical line
                ctx.strokeStyle = marker.color || "#ff6b6b";
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x, top + height);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw label
                ctx.fillStyle = marker.color || "#ff6b6b";
                ctx.font = "14px sans-serif";
                ctx.textAlign = "left";
                ctx.textBaseline = "top";

                // Rotate text 90 degrees and offset from line
                ctx.save();
                ctx.translate(x + 14, top + 5);
                ctx.rotate(Math.PI / 2);
                ctx.fillText(marker.label, 0, 0);
                ctx.restore();
              }
            });

            ctx.restore();
          },
        ],
      },
    };

    // Plugin to draw average load lines
    const averageLoadLinesPlugin = {
      hooks: {
        draw: [
          (u) => {
            const { ctx } = u;
            const { left, top, width, height } = u.bbox;

            if (!manager.averageLoadLines) {
              return;
            }

            const { averageTotal, averageLeft, averageRight, warmupEndTime, endTime } = manager.averageLoadLines;

            // Only draw if we have time bounds for the workout
            if (!warmupEndTime || !endTime) {
              return;
            }

            const warmupEndSec = warmupEndTime.getTime() / 1000;
            const endSec = endTime.getTime() / 1000;
            const x1 = u.valToPos(warmupEndSec, "x", true);
            const x2 = u.valToPos(endSec, "x", true);

            // Only draw if the window is at least partially within visible range
            if (x2 < left || x1 > left + width) {
              return;
            }

            // Clamp x coordinates to visible area
            const drawX1 = Math.max(x1, left);
            const drawX2 = Math.min(x2, left + width);

            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1.5;

            // Draw average total load line (blue)
            if (Number.isFinite(averageTotal)) {
              const y = u.valToPos(averageTotal, "load", true);
              if (y >= top && y <= top + height) {
                ctx.strokeStyle = "rgba(102, 126, 234, 0.6)"; // Semi-transparent blue
                ctx.beginPath();
                ctx.moveTo(drawX1, y);
                ctx.lineTo(drawX2, y);
                ctx.stroke();
              }
            }

            // Draw average left load line (red)
            if (Number.isFinite(averageLeft)) {
              const y = u.valToPos(averageLeft, "load", true);
              if (y >= top && y <= top + height) {
                ctx.strokeStyle = "rgba(255, 107, 107, 0.6)"; // Semi-transparent red
                ctx.beginPath();
                ctx.moveTo(drawX1, y);
                ctx.lineTo(drawX2, y);
                ctx.stroke();
              }
            }

            // Draw average right load line (green)
            if (Number.isFinite(averageRight)) {
              const y = u.valToPos(averageRight, "load", true);
              if (y >= top && y <= top + height) {
                ctx.strokeStyle = "rgba(81, 207, 102, 0.6)"; // Semi-transparent green
                ctx.beginPath();
                ctx.moveTo(drawX1, y);
                ctx.lineTo(drawX2, y);
                ctx.stroke();
              }
            }

            ctx.restore();
          },
        ],
      },
    };

    const opts = {
      width: container.clientWidth || 800,
      height: this.chartHeight,
      plugins: [eventMarkersPlugin, averageLoadLinesPlugin],
      cursor: {
        drag: {
          x: true,
          y: false,
        },
      },
      scales: {
        x: { time: true },

        load: {
          auto: true,
          range: (u, min, max) => {
            // Handle invalid data
            if (!isFinite(max) || max <= 0) {
              return [0, 10]; // Default to 0–10 when no data or all zeros
            }

            // Always start from 0, pad 10% above data max
            const paddedMax = max + max * 0.1;
            return [0, paddedMax];
          },
        },

        position: {
          auto: true,
          range: (u, min, max) => {
            if (!isFinite(max) || max <= 0) {
              return [0, 100]; // Default to 0–100 when no data or all zeros
            }

            const paddedMax = max + max * 0.1;
            return [0, paddedMax];
          },
        },
      },
      series: [
        {
          label: "Time",
          value: (u, v) => {
            if (v == null) return "-";
            const date = new Date(v * 1000);
            return date.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            });
          },
        },
        {
          label: "Total Load",
          stroke: "#667eea",
          width: 1.5,
          scale: "load",
          value: (u, v) => manager.formatLoadValue(v),
        },
        {
          label: "Left Load",
          stroke: "#ff6b6b",
          width: 1.5,
          scale: "load",
          value: (u, v) => manager.formatLoadValue(v),
        },
        {
          label: "Right Load",
          stroke: "#51cf66",
          width: 1.5,
          scale: "load",
          value: (u, v) => manager.formatLoadValue(v),
        },
        {
          label: "Left Position",
          stroke: "#ffa94d",
          width: 1.5,
          scale: "position",
          dash: [5, 5],
          value: (u, v) => (v == null ? "-" : v.toFixed(0)),
        },
        {
          label: "Right Position",
          stroke: "#94d82d",
          width: 1.5,
          scale: "position",
          dash: [5, 5],
          value: (u, v) => (v == null ? "-" : v.toFixed(0)),
        },
        {
          label: "Average Total Load",
          stroke: "rgba(102, 126, 234, 0.6)",
          width: 1.5,
          scale: "load",
          dash: [3, 3],
          value: (u, v) => (v == null || v === 0 ? "-" : manager.formatLoadValue(v)),
        },
        {
          label: "Average Left Load",
          stroke: "rgba(255, 107, 107, 0.6)",
          width: 1.5,
          scale: "load",
          dash: [3, 3],
          value: (u, v) => (v == null || v === 0 ? "-" : manager.formatLoadValue(v)),
        },
        {
          label: "Average Right Load",
          stroke: "rgba(81, 207, 102, 0.6)",
          width: 1.5,
          scale: "load",
          dash: [3, 3],
          value: (u, v) => (v == null || v === 0 ? "-" : manager.formatLoadValue(v)),
        },
      ],
      axes: [
        {
          stroke: "#6c757d",
          grid: {
            show: true,
            stroke: "#dee2e6",
            width: 1,
          },
          ticks: {
            show: true,
            stroke: "#dee2e6",
          },
          values: (u, vals) => {
            // Format x-axis timestamps as HH:MM:SS only
            return vals.map((v) => {
              const date = new Date(v * 1000);
              return date.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              });
            });
          },
        },
        {
          scale: "load",
          label: `Load (${this.loadUnit.label})`,
          labelSize: 20,
          stroke: "#6c757d",
          size: 40,
          grid: {
            show: true,
            stroke: "#dee2e6",
            width: 1,
          },
          ticks: {
            show: true,
            stroke: "#dee2e6",
          },
        },
        {
          scale: "position",
          label: "Position (cm)",
          labelSize: 20,
          stroke: "#6c757d",
          size: 50,
          side: 1, // 1 = right side
          grid: {
            show: false, // Don't show grid for position to avoid clutter
          },
          ticks: {
            show: true,
            stroke: "#dee2e6",
          },
        },
      ],
      legend: {
        show: true,
        live: true,
      },
    };

    this.chart = new uPlot(opts, data, container);

    this.attachResizeObservers(container);

    // Start periodic updates
    this.startPeriodicUpdates();

    return true;
  }

  attachResizeObservers(container) {
    if (typeof window === "undefined" || !container) {
      return;
    }

    if (!this._handleWindowResize) {
      this._handleWindowResize = () => {
        this.resize();
      };
      window.addEventListener("resize", this._handleWindowResize);
    }

    if (typeof window.ResizeObserver === "function") {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
      this.resizeObserver = new window.ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(container);
    }
  }

  resize() {
    const container =
      this.container ||
      (typeof document !== "undefined"
        ? document.getElementById(this.containerId)
        : null);

    if (!this.chart || !container) {
      return false;
    }

    const width = container.clientWidth || container.offsetWidth || 0;

    this.chart.setSize({
      width,
      height: this.chartHeight,
    });

    return true;
  }

  // Start periodic chart updates
  startPeriodicUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Update chart every 10ms, separate from data collection
    this.updateInterval = setInterval(() => {
      this.update();
    }, this.updateFrequency);
  }

  // Stop periodic updates
  stopPeriodicUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  // Add new data point to chart
  addData(sample) {
    // Add to load history
    this.loadHistory.push({
      timestamp: sample.timestamp,
      loadA: sample.loadA,
      loadB: sample.loadB,
      posA: sample.posA,
      posB: sample.posB,
    });

    // Trim history to max points (2hr limit)
    if (this.loadHistory.length > this.maxHistoryPoints) {
      const removed = this.loadHistory.shift();

      // Log when we hit the limit for the first time
      if (this.loadHistory.length === this.maxHistoryPoints && this.onLog) {
        this.onLog(
          "Reached 2hr data limit. Oldest data points will be removed as new data arrives.",
          "info",
        );
      }
    }

    // Chart updates happen on periodic interval
  }

  // Update function called periodically to either add new data or if not live, do nothing.
  update() {
    if (!this.chart || this.loadHistory.length === 0 || !this.live) return;
    this.updateChartData();
  }

  setLoadUnit(config) {
    if (!config) {
      return;
    }

    this.loadUnit = {
      label: config.label || "kg",
      decimals: typeof config.decimals === "number" ? config.decimals : 1,
      toDisplay:
        typeof config.toDisplay === "function"
          ? config.toDisplay
          : (value) => value,
    };

    if (this.chart && this.chart.axes && this.chart.axes[1]) {
      this.chart.axes[1].label = `Load (${this.loadUnit.label})`;
      this.updateChartData();
    }
  }

  formatLoadValue(value) {
    if (value == null || !isFinite(value)) {
      return "-";
    }

    return `${value.toFixed(this.loadUnit.decimals)} ${this.loadUnit.label}`;
  }

  buildSeriesFromPoints(points) {
    const timestamps = [];
    const totalLoads = [];
    const loadsB = [];
    const loadsA = [];
    const positionsB = [];
    const positionsA = [];
    const avgTotalSeries = [];
    const avgLeftSeries = [];
    const avgRightSeries = [];

    for (const point of points) {
      if (!point || !(point.timestamp instanceof Date)) {
        continue;
      }

      const timestampSeconds = point.timestamp.getTime() / 1000;
      timestamps.push(timestampSeconds);

      const loadA = Number(point.loadA) || 0;
      const loadB = Number(point.loadB) || 0;
      const totalKg = loadA + loadB;

      const displayTotal = this.loadUnit.toDisplay(totalKg);
      const displayB = this.loadUnit.toDisplay(loadB);
      const displayA = this.loadUnit.toDisplay(loadA);

      totalLoads.push(
        displayTotal != null && isFinite(displayTotal) ? displayTotal : 0,
      );
      loadsB.push(displayB != null && isFinite(displayB) ? displayB : 0);
      loadsA.push(displayA != null && isFinite(displayA) ? displayA : 0);
      positionsB.push(Number(point.posB) || 0);
      positionsA.push(Number(point.posA) || 0);

      // Placeholder for average lines (will be populated when averageLoadLines is set)
      avgTotalSeries.push(0);
      avgLeftSeries.push(0);
      avgRightSeries.push(0);
    }

    return [
      timestamps,
      totalLoads,
      loadsB,
      loadsA,
      positionsB,
      positionsA,
      avgTotalSeries,
      avgLeftSeries,
      avgRightSeries,
    ];
  }

  // Update chart with all data and trim time scale to current time range.
  updateChartData() {
    const data = this.buildSeriesFromPoints(this.loadHistory);
    const timestamps = data[0];

    this.chart.setData(data);

    // Auto-scroll to show latest data if user hasn't manually panned
    if (this.currentTimeRange !== null && timestamps.length > 0) {
      const latestTime = timestamps[timestamps.length - 1];
      const minTime = latestTime - this.currentTimeRange;
      this.chart.setScale("x", { min: minTime, max: latestTime });
    }
  }

  // Set time range for chart view
  setTimeRange(seconds) {
    this.currentTimeRange = seconds;

    // Update button active states
    document.getElementById("range10s").classList.remove("active");
    document.getElementById("range30s").classList.remove("active");
    document.getElementById("range60s").classList.remove("active");
    document.getElementById("range2m").classList.remove("active");
    document.getElementById("rangeAll").classList.remove("active");

    if (seconds) {
      this.live = true;
    }

    if (seconds === 10) {
      document.getElementById("range10s").classList.add("active");
    } else if (seconds === 30) {
      document.getElementById("range30s").classList.add("active");
    } else if (seconds === 60) {
      document.getElementById("range60s").classList.add("active");
    } else if (seconds === 120) {
      document.getElementById("range2m").classList.add("active");
    } else {
      this.live = false;
      this.updateChartData(); // Update chart with all data
      document.getElementById("rangeAll").classList.add("active");
    }

    // Update chart view
    this.update();
  }

  // Export chart data as CSV
  exportCSV() {
    if (this.loadHistory.length === 0) {
      alert("No data to export yet!");
      return;
    }

    // Build CSV content
    const unitLabel = this.loadUnit.label;
    const csvDecimals = Math.max(2, this.loadUnit.decimals);
    const formatCsvValue = (kg) => {
      const converted = this.loadUnit.toDisplay(kg);
      if (converted == null || !isFinite(converted)) {
        return "";
      }
      return converted.toFixed(csvDecimals);
    };

    let csv = `Timestamp,Total Load (${unitLabel}),Right Load (${unitLabel}),Left Load (${unitLabel}),Right Position,Left Position\n`;

    for (const point of this.loadHistory) {
      const timestamp = point.timestamp.toISOString();
      const totalKg = point.loadA + point.loadB;
      const totalLoad = formatCsvValue(totalKg);
      const loadA = formatCsvValue(point.loadA);
      const loadB = formatCsvValue(point.loadB);
      const posA = point.posA;
      const posB = point.posB;
      csv += `${timestamp},${totalLoad},${loadA},${loadB},${posA},${posB}\n`;
    }

    // Create download link
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workout_${new Date().toISOString().split("T")[0]}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (this.onLog) {
      this.onLog(
        `Exported ${this.loadHistory.length} data points to CSV`,
        "success",
      );
    }
  }

  // Clear all data
  clear() {
    this.loadHistory = [];
    this.update();
  }

  // Get current data point count
  getDataCount() {
    return this.loadHistory.length;
  }

  // Set event markers for a workout
  setEventMarkers(markers) {
    this.eventMarkers = markers;
    if (this.chart) {
      this.chart.redraw();
    }
  }

  // Clear event markers
  clearEventMarkers() {
    this.eventMarkers = [];
    if (this.chart) {
      this.chart.redraw();
    }
  }

  // Set average load lines to display on chart
  setAverageLoadLines(averageTotal, averageLeft, averageRight, warmupEndTime, endTime) {
    this.averageLoadLines = {
      averageTotal: Number.isFinite(averageTotal) ? averageTotal : null,
      averageLeft: Number.isFinite(averageLeft) ? averageLeft : null,
      averageRight: Number.isFinite(averageRight) ? averageRight : null,
      warmupEndTime: warmupEndTime instanceof Date ? warmupEndTime : null,
      endTime: endTime instanceof Date ? endTime : null,
    };

    // Update the average series with the constant values if chart data exists
    if (this.chart && this.chart.data) {
      const data = [...this.chart.data];
      // Series indices: 6 = avgTotal, 7 = avgLeft, 8 = avgRight
      if (data[6]) {
        data[6] = data[6].map(() => (Number.isFinite(averageTotal) ? this.loadUnit.toDisplay(averageTotal) : 0));
      }
      if (data[7]) {
        data[7] = data[7].map(() => (Number.isFinite(averageLeft) ? this.loadUnit.toDisplay(averageLeft) : 0));
      }
      if (data[8]) {
        data[8] = data[8].map(() => (Number.isFinite(averageRight) ? this.loadUnit.toDisplay(averageRight) : 0));
      }
      this.chart.setData(data);
    }

    if (this.chart) {
      this.chart.redraw();
    }
  }

  // Clear average load lines
  clearAverageLoadLines() {
    this.averageLoadLines = null;
    if (this.chart) {
      this.chart.redraw();
    }
  }

  // View a specific workout on the graph
  viewWorkout(workout) {
    if (!workout.startTime || !workout.endTime) {
      if (this.onLog) {
        this.onLog("Workout does not have timing information", "error");
      }
      return;
    }

    // Set event markers for this workout
    const markers = [
      {
        time: workout.startTime,
        label: "Start",
        color: "#51cf66",
      },
    ];

    if (workout.warmupEndTime) {
      markers.push({
        time: workout.warmupEndTime,
        label: "Load",
        color: "#ffa94d",
      });
    }

    markers.push({
      time: workout.endTime,
      label: "End",
      color: "#ff6b6b",
    });

    this.setEventMarkers(markers);

    // Replace chart data with the workout's movement data if available
    let displayedReplayData = false;
    if (Array.isArray(workout.movementData) && workout.movementData.length > 0) {
      const data = this.buildSeriesFromPoints(workout.movementData);
      if (data[0].length > 0) {
        this.chart.setData(data);
        displayedReplayData = true;
      } else if (this.onLog) {
        this.onLog("Workout does not have valid movement data for the chart", "warning");
      }
    } else if (this.onLog) {
      this.onLog("Workout does not have movement data to display", "warning");
    }

    // Set average load lines if available
    const averageTotal = Number.isFinite(workout.averageLoad) ? workout.averageLoad : null;
    const averageLeft = Number.isFinite(workout.averageLoadLeft) ? workout.averageLoadLeft : null;
    const averageRight = Number.isFinite(workout.averageLoadRight) ? workout.averageLoadRight : null;
    if (averageTotal !== null || averageLeft !== null || averageRight !== null) {
      this.setAverageLoadLines(
        averageTotal,
        averageLeft,
        averageRight,
        workout.warmupEndTime,
        workout.endTime,
      );
    } else {
      this.clearAverageLoadLines();
    }

    // Set time range to show the workout
    this.live = false;
    this.currentTimeRange = null;

    // If no replay data was shown, fall back to current load history
    if (!displayedReplayData) {
      this.updateChartData();
    }

    // Update button active states to show "All" is active
    document.getElementById("range10s").classList.remove("active");
    document.getElementById("range30s").classList.remove("active");
    document.getElementById("range60s").classList.remove("active");
    document.getElementById("range2m").classList.remove("active");
    document.getElementById("rangeAll").classList.add("active");

    // Calculate time bounds with some padding
    const startTime = workout.startTime.getTime() / 1000;
    const endTime = workout.endTime.getTime() / 1000;
    const duration = endTime - startTime;
    const padding = duration * 0.1; // 10% padding on each side

    // Set chart scale to show the workout
    if (this.chart) {
      this.chart.setScale("x", {
        min: startTime - padding,
        max: endTime + padding,
      });
    }

    if (this.onLog) {
      this.onLog(`Viewing workout: ${workout.mode}`, "info");
    }
  }
}
