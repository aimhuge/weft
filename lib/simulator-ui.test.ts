import { beforeEach, describe, expect, it, vi } from "vitest";

// What's on a device's screen and the touches that act on it. The tools behind it (axe, adb) are
// faked: each call is recorded so the test can pin the exact command line.
const exec = vi.hoisted(() => ({
  run: vi.fn<(name: string, args: string[], opts?: unknown) => Promise<Buffer>>(),
  runText: vi.fn<(name: string, args: string[], opts?: unknown) => Promise<string>>(),
}));

vi.mock("./simulator-exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./simulator-exec")>();
  return { ...actual, run: exec.run, runText: exec.runText };
});

type Ui = typeof import("./simulator-ui");
type Element = import("./simulator-ui").Element;
type Device = import("./simulator-devices").Device;

const ui: Ui = await import("./simulator-ui");

const ios: Device = { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted" };
const android: Device = { id: "emulator-5554", name: "Pixel 8", platform: "android", state: "booted" };

beforeEach(() => {
  exec.run.mockReset().mockResolvedValue(Buffer.alloc(0));
  exec.runText.mockReset().mockResolvedValue("");
});

// An element to build a tree out of.
const el = (over: Partial<Element> = {}): Element => ({
  index: 0,
  type: "Button",
  label: "",
  id: "",
  value: "",
  frame: { x: 0, y: 0, width: 10, height: 10 },
  ...over,
});

// The element at an index, for the tests that read one out of a parsed tree.
const at = (list: Element[], index: number): Element => {
  const found = list[index];
  if (!found) throw new Error(`No element at ${index}.`);
  return found;
};

describe("parseAxTree", () => {
  it("reads an array of root nodes with their children", () => {
    const tree = ui.parseAxTree(
      JSON.stringify([
        { type: "Window", AXLabel: "Home", frame: { x: 1, y: 2, width: 3, height: 4 }, children: [{ type: "Button", AXLabel: "Go" }] },
        { type: "Window", AXLabel: "Other" },
      ]),
    );
    expect(tree).toHaveLength(3);
    expect(at(tree, 0)).toEqual({ index: 0, type: "Window", label: "Home", id: "", value: "", frame: { x: 1, y: 2, width: 3, height: 4 } });
    expect(at(tree, 1)).toMatchObject({ index: 1, type: "Button", label: "Go" });
    expect(at(tree, 2)).toMatchObject({ index: 2, label: "Other" });
  });

  it("reads a single root node as one element", () => {
    expect(ui.parseAxTree(JSON.stringify({ type: "Button", AXLabel: "Go" }))).toHaveLength(1);
  });

  it("leaves a null label empty and falls back to the role for the type", () => {
    const tree = ui.parseAxTree(JSON.stringify({ role: "AXButton", AXLabel: null, AXUniqueId: null, AXValue: null }));
    expect(at(tree, 0)).toEqual({ index: 0, type: "Button", label: "", id: "", value: "", frame: { x: 0, y: 0, width: 0, height: 0 } });
  });

  it("trims the strings it reads and ignores a missing or broken frame", () => {
    const tree = ui.parseAxTree(JSON.stringify({ type: " Button ", AXLabel: "  Go  ", AXUniqueId: " id ", AXValue: " v ", frame: { x: "1", y: Number.NaN } }));
    expect(at(tree, 0)).toMatchObject({ type: "Button", label: "Go", id: "id", value: "v" });
    expect(at(tree, 0).frame).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("parseUiautomator", () => {
  it("reads each node's bounds into a frame", () => {
    const tree = ui.parseUiautomator('<node class="android.widget.TextView" text="Hello" bounds="[10,20][110,60]"/>');
    expect(tree).toEqual([{ index: 0, type: "TextView", label: "Hello", id: "", value: "", frame: { x: 10, y: 20, width: 100, height: 40 } }]);
  });

  it("decodes the entities in a node's attributes", () => {
    const tree = ui.parseUiautomator('<node class="android.widget.TextView" text="a &amp; b &quot;c&quot; &apos;d&apos; &lt;e&gt;" bounds="[0,0][1,1]"/>');
    expect(at(tree, 0).label).toBe(`a & b "c" 'd' <e>`);
  });

  it("drops the package from a resource id", () => {
    const tree = ui.parseUiautomator('<node class="android.widget.Button" resource-id="com.example.app:id/login" bounds="[0,0][1,1]"/>');
    expect(at(tree, 0).id).toBe("login");
  });

  it("falls back to the content description when there is no text", () => {
    const tree = ui.parseUiautomator('<node class="android.widget.ImageButton" content-desc="Close" bounds="[0,0][1,1]"/>');
    expect(at(tree, 0).label).toBe("Close");
  });

  it("leaves the type and id empty when the node has no class or resource id", () => {
    const tree = ui.parseUiautomator('<node text="Hi" bounds="[0,0][1,1]"/>');
    expect(at(tree, 0).type).toBe("");
    expect(at(tree, 0).id).toBe("");
  });

  it("is an empty frame when the bounds are missing or unusable", () => {
    const tree = ui.parseUiautomator('<node class="android.widget.TextView" text="Hi"/>');
    expect(at(tree, 0).frame).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("named", () => {
  it("keeps the elements with something to identify them and a size on screen", () => {
    const els = [
      el({ label: "Go" }),
      el({ id: "login" }),
      el({ value: "typed" }),
      el({ type: "Window" }),
      el({ label: "Flat", frame: { x: 0, y: 0, width: 0, height: 10 } }),
    ];
    expect(ui.named(els).map((e) => e.label || e.id || e.value)).toEqual(["Go", "login", "typed"]);
  });
});

describe("describe", () => {
  it("names an element by its index, type, label, id, value and frame", () => {
    const line = ui.describe(el({ index: 2, type: "Button", label: "Go", id: "login", value: "Go" }));
    expect(line).toBe(`[2] Button "Go" #login (0,0 10x10)`);
  });

  it("leaves out a value that is the same as the label", () => {
    expect(ui.describe(el({ label: "Go", value: "Go" }))).not.toContain("=");
  });

  it("shows a value that is different from the label", () => {
    expect(ui.describe(el({ label: "Go", value: "Typed" }))).toContain('= "Typed"');
  });

  it("falls back to a generic type and rounds the frame", () => {
    expect(ui.describe(el({ type: "", frame: { x: 0.4, y: 0.6, width: 10.5, height: 20.4 } }))).toBe("[0] Element (0,1 11x20)");
  });
});

describe("findElement", () => {
  const els: Element[] = [
    el({ index: 0, type: "Button", label: "Sign In", id: "login" }),
    el({ index: 1, type: "Button", label: "Cancel" }),
    el({ index: 2, type: "Text", label: "Hidden", frame: { x: 0, y: 0, width: 0, height: 0 } }),
  ];

  it("finds an element by its index", () => {
    expect(ui.findElement(els, "1").label).toBe("Cancel");
    expect(ui.findElement(els, "[1]").label).toBe("Cancel");
  });

  it("finds an element by its id", () => {
    expect(ui.findElement(els, "login").label).toBe("Sign In");
  });

  it("finds an element by its exact label", () => {
    expect(ui.findElement(els, "Cancel").label).toBe("Cancel");
  });

  it("finds an element whose label or id matches whatever the case", () => {
    expect(ui.findElement(els, "sign in").label).toBe("Sign In");
    expect(ui.findElement(els, "LOGIN").label).toBe("Sign In");
  });

  it("finds an element whose label contains the words", () => {
    expect(ui.findElement(els, "can").label).toBe("Cancel");
  });

  it("says nothing on screen matches when there is no such element", () => {
    expect(() => ui.findElement(els, "nope")).toThrow('Nothing on screen matches "nope".');
  });
});

describe("center", () => {
  it("is the middle of an element's frame, rounded", () => {
    expect(ui.center(el({ frame: { x: 10, y: 20, width: 31, height: 41 } }))).toEqual({ x: 26, y: 41 });
  });
});

describe("tapAt", () => {
  it("taps a point on an iOS simulator with AXe", async () => {
    await ui.tapAt(ios, 12, 34);
    expect(exec.run).toHaveBeenCalledWith("axe", ["tap", "-x", "12", "-y", "34", "--udid", "udid-1"]);
  });

  it("taps a point on an Android device with adb", async () => {
    await ui.tapAt(android, 12, 34);
    expect(exec.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "shell", "input", "tap", "12", "34"]);
  });
});

describe("swipe", () => {
  it("swipes on an iOS simulator with AXe", async () => {
    await ui.swipe(ios, { x: 1, y: 2 }, { x: 3, y: 4 });
    expect(exec.run).toHaveBeenCalledWith("axe", ["swipe", "--start-x", "1", "--start-y", "2", "--end-x", "3", "--end-y", "4", "--duration", "0.3", "--udid", "udid-1"]);
  });

  it("swipes on an Android device with adb", async () => {
    await ui.swipe(android, { x: 1, y: 2 }, { x: 3, y: 4 });
    expect(exec.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "shell", "input", "swipe", "1", "2", "3", "4", "300"]);
  });

  it("swipes for as long as it is told", async () => {
    await ui.swipe(android, { x: 0, y: 0 }, { x: 1, y: 1 }, 800);
    expect(exec.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "shell", "input", "swipe", "0", "0", "1", "1", "800"]);
  });
});

describe("typeText", () => {
  it("types into an iOS simulator with AXe", async () => {
    await ui.typeText(ios, "hello");
    expect(exec.run).toHaveBeenCalledWith("axe", ["type", "hello", "--udid", "udid-1"]);
  });

  it("types into an Android device, quoting the text for the device's shell", async () => {
    await ui.typeText(android, "hello world");
    expect(exec.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "shell", "input", "text", "'hello%sworld'"]);
  });

  it("escapes a percent sign so the device's shell doesn't read it", async () => {
    await ui.typeText(android, "100%");
    expect(exec.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "shell", "input", "text", "'100\\%'"]);
  });
});

describe("press", () => {
  it("presses a key on an Android device with adb", async () => {
    await ui.press(android, "back");
    expect(exec.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "shell", "input", "keyevent", "4"]);
  });

  it("presses a button on an iOS simulator with AXe", async () => {
    await ui.press(ios, "home");
    expect(exec.run).toHaveBeenCalledWith("axe", ["button", "home", "--udid", "udid-1"]);
  });

  it("sends the return key as a key code on iOS", async () => {
    await ui.press(ios, "enter");
    expect(exec.run).toHaveBeenCalledWith("axe", ["key", "40", "--udid", "udid-1"]);
  });

  it("says iOS has no back button", async () => {
    await expect(ui.press(ios, "back")).rejects.toThrow("iOS has no back button");
  });
});

describe("directionSwipe", () => {
  const screen = el({ index: 0, type: "Window", frame: { x: 0, y: 0, width: 100, height: 200 } });

  it("swipes up the screen", () => {
    expect(ui.directionSwipe([screen], "up")).toEqual({ from: { x: 50, y: 160 }, to: { x: 50, y: 40 } });
  });

  it("swipes down the screen", () => {
    expect(ui.directionSwipe([screen], "down")).toEqual({ from: { x: 50, y: 40 }, to: { x: 50, y: 160 } });
  });

  it("swipes left across the screen", () => {
    expect(ui.directionSwipe([screen], "left")).toEqual({ from: { x: 80, y: 100 }, to: { x: 20, y: 100 } });
  });

  it("swipes right across the screen", () => {
    expect(ui.directionSwipe([screen], "right")).toEqual({ from: { x: 20, y: 100 }, to: { x: 80, y: 100 } });
  });

  it("sizes the swipe from the biggest frame in the tree", () => {
    const bigger = el({ index: 1, frame: { x: 0, y: 0, width: 200, height: 400 } });
    expect(ui.directionSwipe([screen, bigger], "up")).toEqual({ from: { x: 100, y: 320 }, to: { x: 100, y: 80 } });
  });

  it("keeps the biggest frame when a later element is smaller", () => {
    const smaller = el({ index: 1, frame: { x: 0, y: 0, width: 10, height: 20 } });
    expect(ui.directionSwipe([screen, smaller], "up")).toEqual({ from: { x: 50, y: 160 }, to: { x: 50, y: 40 } });
  });

  it("says it couldn't tell the screen's size when no element has one", () => {
    expect(() => ui.directionSwipe([], "up")).toThrow("Couldn't tell the screen's size");
  });
});

describe("uiTree", () => {
  it("reads an iOS screen through AXe", async () => {
    exec.runText.mockResolvedValue(JSON.stringify([{ type: "Button", AXLabel: "Go" }]));
    const tree = await ui.uiTree(ios);
    expect(exec.runText).toHaveBeenCalledWith("axe", ["describe-ui", "--udid", "udid-1"]);
    expect(at(tree, 0)).toMatchObject({ label: "Go", type: "Button" });
  });

  it("reads an Android screen through uiautomator", async () => {
    exec.runText.mockResolvedValue('<node class="android.widget.TextView" text="Hi" bounds="[0,0][10,20]"/>');
    const tree = await ui.uiTree(android);
    expect(exec.runText).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "exec-out", "uiautomator", "dump", "/dev/tty"]);
    expect(at(tree, 0)).toMatchObject({ label: "Hi", type: "TextView" });
  });
});
