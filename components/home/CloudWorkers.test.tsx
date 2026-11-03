// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../test-utils";
import CloudWorkers, { CLOUD_POINTS } from "./CloudWorkers";

// components/home/CloudWorkers.tsx: the Cloud Workers request card under the plans.

describe("CloudWorkers", () => {
  it("asks what they'd use one for, and posts it to the request route", () => {
    const { container, getByLabelText } = render(<CloudWorkers />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/api/cloud-workers/request");
    expect(form.getAttribute("method")).toBe("post");
    expect(getByLabelText("What would you use a cloud worker for?").getAttribute("name")).toBe("use");
    expect(getByLabelText("Email").getAttribute("type")).toBe("email");
    expect(container.querySelectorAll(".wz-cloudPoints li")).toHaveLength(CLOUD_POINTS.length);
  });

  it("carries the reply anchors the route redirects to", () => {
    const { container } = render(<CloudWorkers />);
    expect(container.querySelector("#wz-cloudSent")).not.toBeNull();
    expect(container.querySelector("#wz-cloudFailed")).not.toBeNull();
  });
});
