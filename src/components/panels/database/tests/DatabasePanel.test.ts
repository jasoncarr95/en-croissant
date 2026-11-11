import { describe, expect, it } from "vitest";
import databasePanelSource from "../DatabasePanel.tsx?raw";

describe("DatabasePanel local position controls", () => {
    it("searches the tab's own database at the debounced board position", () => {
        expect(databasePanelSource).toContain("value={localOptions.path}");
        expect(databasePanelSource).toContain("onChange={setLocalDatabase}");
        expect(databasePanelSource).toContain("<LocalOptionsPanel file={localOptions.path} />");
        expect(databasePanelSource).toContain("syncLocalFen(debouncedFen)");
        expect(databasePanelSource).toContain("fen: debouncedFen");
    });

    it("never writes the global reference database", () => {
        expect(databasePanelSource).not.toContain("storedReferenceDbAtom");
    });
});
