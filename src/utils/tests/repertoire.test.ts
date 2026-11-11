import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PositionStats } from "@/bindings";
import type { TreeNode } from "@/utils/treeReducer";

const searchPosition = vi.hoisted(() => vi.fn());
vi.mock("@/utils/db", () => ({ searchPosition }));

import { computeTreeCoverage } from "@/utils/repertoire";

const node = (
    fen: string,
    san: string | null,
    halfMoves: number,
    children: TreeNode[] = [],
): TreeNode => ({
    fen,
    move: null,
    san,
    children,
    score: null,
    depth: null,
    halfMoves,
    shapes: [],
    annotations: [],
    comment: "",
});

const stats = (move: string, total: number): PositionStats => ({
    move,
    total,
    white: total,
    draw: 0,
    black: 0,
});

// A white repertoire where Black reaches the same position by two move orders:
// 1.d4 d5 2.c4 e6 3.Nc3 c6 4.Nf3 and 1.d4 d5 2.c4 c6 3.Nc3 e6 4.Nf3.
const transposingRepertoire = () =>
    node("start", null, 0, [
        node("after-d4", "d4", 1, [
            node("after-d5", "d5", 2, [
                node("after-c4", "c4", 3, [
                    node("after-e6", "e6", 4, [
                        node("e6-Nc3", "Nc3", 5, [
                            node("transposed", "c6", 6, [node("after-Nf3", "Nf3", 7)]),
                        ]),
                    ]),
                    node("after-c6", "c6", 4, [
                        node("c6-Nc3", "Nc3", 5, [
                            node("transposed", "e6", 6, [node("after-Nf3", "Nf3", 7)]),
                        ]),
                    ]),
                ]),
            ]),
        ]),
    ]);

const database: Record<string, PositionStats[]> = {
    "after-d4": [stats("d5", 100)],
    "after-c4": [stats("e6", 60), stats("c6", 40)],
    "e6-Nc3": [stats("c6", 60)],
    "c6-Nc3": [stats("e6", 40)],
    "after-Nf3": [stats("Nf6", 50)],
};

describe("computeTreeCoverage", () => {
    beforeEach(() => {
        searchPosition.mockReset();
        searchPosition.mockImplementation(async (options: { position: { fen: string } }) => [
            database[options.position.fen] ?? [stats("any", 100)],
            [],
        ]);
    });

    it("gives coverage to the moves under both move orders of a transposition", async () => {
        const { coverageMap, gamesMap, missingGamesMap } = await computeTreeCoverage(
            transposingRepertoire(),
            "white",
            "/db/reference.duckdb",
            10,
        );

        const first = "0,0,0,0,0,0";
        const second = "0,0,0,1,0,0";
        expect(coverageMap.get(first)).toBeCloseTo(0.2);
        expect(coverageMap.get(second)).toBeCloseTo(0.2);

        for (const transposed of [first, second]) {
            const reply = `${transposed},0`;
            expect(coverageMap.get(reply)).toBeCloseTo(0.2);
            expect(gamesMap.get(reply)).toBe(50);
            expect(missingGamesMap.get(reply)).toBe(50);
        }
        expect(coverageMap.get("")).toBeCloseTo(0.2);
    });

    it("searches each position once however often it is reached", async () => {
        await computeTreeCoverage(transposingRepertoire(), "white", "/db/reference.duckdb", 10);

        const searched: string[] = searchPosition.mock.calls.map(
            ([options]) => options.position.fen,
        );
        expect(searched.filter((fen) => fen === "transposed")).toHaveLength(1);
        expect(searched.filter((fen) => fen === "after-Nf3")).toHaveLength(1);
        expect(new Set(searched).size).toBe(searched.length);
    });

    it("stops when aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            computeTreeCoverage(
                transposingRepertoire(),
                "white",
                "/db/reference.duckdb",
                10,
                [],
                controller.signal,
            ),
        ).rejects.toThrow();
        expect(searchPosition).not.toHaveBeenCalled();
    });
});
