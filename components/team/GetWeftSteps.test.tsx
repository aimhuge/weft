// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "../test-utils";
import { GetWeftSteps, MAC_DOWNLOAD, WINDOWS_DOWNLOAD } from "./GetWeftSteps";

describe("GetWeftSteps", () => {
  it("leads with the download and names the workspace", () => {
    render(<GetWeftSteps orgName="Exiting.com" />);
    expect(screen.getByText("You're in Exiting.com")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Next: get Weft on your computer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download for Mac" })).toHaveAttribute("href", MAC_DOWNLOAD);
    expect(screen.getByRole("link", { name: "Windows" })).toHaveAttribute("href", WINDOWS_DOWNLOAD);
  });

  it("walks through connecting Claude and signing in, in order", () => {
    render(<GetWeftSteps orgName="Acme" />);
    const steps = screen.getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent);
    expect(steps).toEqual(["Download Weft", "Connect your Claude", "Sign in to Weft with GitHub and prompt"]);
  });
});
