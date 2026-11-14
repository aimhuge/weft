// Every test file: the card routes' activation stats (lib/activation.ts) never post to weft.zip from a test.
// lib/activation.test.ts tests the real module through vi.importActual.
import { vi } from "vitest";

vi.mock("../lib/activation", () => ({ ACTIVATION_FILE: "", trackActivation: vi.fn(() => Promise.resolve(false)) }));
