export const APP_VERSION = "0.0.5";

export const getVersionLabel = (options = {}) => {
  const prefix = typeof options.prefix === "string" ? options.prefix : "v";
  return `${prefix}${APP_VERSION}`;
};

const sharedVersionApi = {
  APP_VERSION,
  getVersionLabel
};

if (typeof globalThis !== "undefined") {
  const existingInfo = globalThis.WorkoutTimeAppInfo ?? {};
  globalThis.WorkoutTimeAppInfo = {
    ...existingInfo,
    version: APP_VERSION,
    getVersionLabel
  };
}

if (
  typeof document !== "undefined" &&
  typeof document.dispatchEvent === "function"
) {
  const eventDetail = {
    version: APP_VERSION,
    label: getVersionLabel({ prefix: "v" })
  };

  try {
    document.dispatchEvent(
      new CustomEvent("workouttime:version-ready", { detail: eventDetail })
    );
  } catch (error) {
    try {
      const fallbackEvent = document.createEvent("CustomEvent");
      fallbackEvent.initCustomEvent(
        "workouttime:version-ready",
        false,
        false,
        eventDetail
      );
      document.dispatchEvent(fallbackEvent);
    } catch (fallbackError) {
      document.dispatchEvent(new Event("workouttime:version-ready"));
    }
  }
}

export default sharedVersionApi;
