// @vitest-environment happy-dom
// A worker project's pin and hide, kept by this board apart from the Mac's settings list.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readWorkerMarks, setWorkerMarks, subscribeWorkerMarks, workerMarksSnapshot } from "./worker-project-marks";

beforeEach(() => localStorage.clear());

describe("worker project marks", () => {
  it("sets only the marks given, drops one turned off, and lets go of a project with none", () => {
    const heard = vi.fn();
    const off = subscribeWorkerMarks(heard);
    expect(readWorkerMarks(workerMarksSnapshot())).toEqual({});
    setWorkerMarks("worker://w1/ling", { pinned: true });
    setWorkerMarks("worker://w1/ling", { hidden: true });
    expect(readWorkerMarks(workerMarksSnapshot())).toEqual({ "worker://w1/ling": { pinned: true, hidden: true } });
    setWorkerMarks("worker://w1/ling", { pinned: false, hidden: false });
    expect(workerMarksSnapshot()).toBe("{}");
    expect(heard).toHaveBeenCalledTimes(3);
    off();
    setWorkerMarks("worker://w1/ling", { pinned: true });
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("reads a broken or wrong-shaped store as no marks", () => {
    expect(readWorkerMarks("{")).toEqual({});
    expect(readWorkerMarks("[1]")).toEqual({});
    expect(readWorkerMarks("null")).toEqual({});
  });
});
