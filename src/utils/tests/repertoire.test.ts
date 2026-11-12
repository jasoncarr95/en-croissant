import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PositionStats } from "@/bindings";
import type { TreeNode } from "@/utils/treeReducer";

const searchPosition = vi.hoisted(() => vi.fn());
vi.mock("@/utils/db", () => ({ searchPosition }));

import { computeTreeCoverage, findBiggestGap, findNextGap } from "@/utils/repertoire";

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

// Builds a repertoire from lines of SAN moves, with the FENs the app would store on each node.
function treeFromLines(lines: string[]) {
    const root = node(makeFen(Chess.default().toSetup()), null, 0);
    const seen = new Map<string, { fen: string; pathKey: string }>([
        ["", { fen: root.fen, pathKey: "" }],
    ]);

    for (const line of lines) {
        const pos = Chess.default();
        let current = root;
        const path: number[] = [];
        const played: string[] = [];
        for (const san of line.split(" ")) {
            pos.play(parseSan(pos, san)!);
            played.push(san);
            let index = current.children.findIndex((child) => child.san === san);
            if (index === -1) {
                current.children.push(node(makeFen(pos.toSetup()), san, current.halfMoves + 1));
                index = current.children.length - 1;
            }
            current = current.children[index];
            path.push(index);
            seen.set(played.join(" "), { fen: current.fen, pathKey: path.join(",") });
        }
    }

    return { root, at: (line: string) => seen.get(line)! };
}

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

    it("reads a position the same when it is reached by a rarely played move order", async () => {
        // 2...c6 is played in too few games to be followed, yet 3...e6 lands in a position the
        // 2...e6 move order already covers.
        searchPosition.mockImplementation(async (options: { position: { fen: string } }) => [
            options.position.fen === "after-c4"
                ? [stats("e6", 60), stats("c6", 5)]
                : (database[options.position.fen] ?? [stats("any", 100)]),
            [],
        ]);

        const { coverageMap, gamesMap, missingGamesMap } = await computeTreeCoverage(
            transposingRepertoire(),
            "white",
            "/db/reference.duckdb",
            10,
        );

        const common = "0,0,0,0,0,0";
        const rare = "0,0,0,1,0,0";
        for (const key of [rare, `${rare},0`]) {
            const twin = key.replace(rare, common);
            expect(coverageMap.get(key)).toBeCloseTo(coverageMap.get(twin)!);
            expect(missingGamesMap.get(key)).toBe(missingGamesMap.get(twin));
        }
        expect(coverageMap.get(`${rare},0`)).toBeCloseTo(0.2);

        // The gap buttons keep to the common move order: no game counts under the rare one.
        expect(gamesMap.has(rare)).toBe(false);
        expect(gamesMap.has(`${rare},0`)).toBe(false);
        const tree = transposingRepertoire();
        expect(findNextGap(tree, [], "white", coverageMap, gamesMap, 10)).toEqual([
            0, 0, 0, 0, 0, 0, 0,
        ]);
        const biggest = findBiggestGap(tree, "white", coverageMap, gamesMap, missingGamesMap, 10);
        expect(biggest?.join(",").startsWith("0,0,0,1")).toBe(false);

        // The rare moves themselves lead nowhere common until then: no search, no coverage.
        const searched: string[] = searchPosition.mock.calls.map(
            ([options]) => options.position.fen,
        );
        expect(searched).not.toContain("after-c6");
        expect(searched).not.toContain("c6-Nc3");
        expect(coverageMap.has("0,0,0,1")).toBe(false);
        expect(coverageMap.has("0,0,0,1,0")).toBe(false);
        expect(new Set(searched).size).toBe(searched.length);
    });

    it("treats move orders that differ only in the halfmove clock as one position", async () => {
        // Real positions: 3.Nf3 leaves the halfmove clock at 1, 3.c4 resets it to 0, yet the
        // board is the same and the database counts both as one position.
        const common = "d4 Nf6 c4 e6 Nf3";
        const rare = "d4 Nf6 Nf3 e6 c4";
        const { root, at } = treeFromLines([`${common} d5`, `${rare} d5`]);
        expect(at(common).fen).not.toBe(at(rare).fen);

        const withoutClocks = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
        const realDatabase: Record<string, PositionStats[]> = {
            [withoutClocks(at("").fen)]: [stats("d4", 100)],
            [withoutClocks(at("d4 Nf6").fen)]: [stats("c4", 60), stats("Nf3", 5)],
            [withoutClocks(at("d4 Nf6 c4 e6").fen)]: [stats("Nf3", 50)],
            [withoutClocks(at(`${common} d5`).fen)]: [stats("Nc3", 40)],
        };
        searchPosition.mockImplementation(async (options: { position: { fen: string } }) => [
            realDatabase[withoutClocks(options.position.fen)] ?? [stats("any", 100)],
            [],
        ]);

        const { coverageMap, missingGamesMap } = await computeTreeCoverage(
            root,
            "black",
            "/db/reference.duckdb",
            10,
        );

        expect(coverageMap.get(at(common).pathKey)).toBeCloseTo(0.25);
        expect(coverageMap.get(at(rare).pathKey)).toBeCloseTo(0.25);
        expect(coverageMap.get(at(`${rare} d5`).pathKey)).toBeCloseTo(0.25);
        expect(missingGamesMap.get(at(rare).pathKey)).toBe(missingGamesMap.get(at(common).pathKey));

        const searched: string[] = searchPosition.mock.calls.map(([options]) =>
            withoutClocks(options.position.fen),
        );
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
