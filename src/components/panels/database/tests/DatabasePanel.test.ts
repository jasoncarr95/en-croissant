import { describe, expect, it } from "vitest";
import databasePanelSource from "../DatabasePanel.tsx?raw";

describe("DatabasePanel local position controls", () => {
    it("uses the immediate board FEN for local controls while queries remain debounced", () => {
        expect(databasePanelSource).toContain("<LocalOptionsPanel boardFen={fen} />");
        expect(databasePanelSource).toContain("syncLocalFen(debouncedFen)");
        expect(databasePanelSource).toContain("fen: debouncedFen");
    });
});
