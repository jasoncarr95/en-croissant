import { searchPosition } from "./db";
import { getNodeAtPath, type TreeNode, treeIterator } from "./treeReducer";
import { TreeStoreState } from "@/state/store/tree";
import { memoize } from "proxy-memoize";

export type PositionMove = {
    san: string;
    games: number;
    totalGames: number;
    frequency: number;
    white: number;
    draw: number;
    black: number;
    inRepertoire: boolean;
    coverage: number;
    childIndex: number;
};

// The database matches a position by pieces, side to move, castling rights and en-passant square.
// Move orders that differ only in the halfmove clock or move number are therefore one position.
const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

export async function computeTreeCoverage(
    root: TreeNode,
    userColor: "white" | "black",
    dbPath: string,
    minGames: number,
    startPath: number[] = [],
    signal?: AbortSignal,
): Promise<{
    coverageMap: Map<string, number>;
    gamesMap: Map<string, number>;
    missingGamesMap: Map<string, number>;
}> {
    const userParity = userColor === "white" ? 0 : 1;
    const coverageMap = new Map<string, number>();
    const gamesMap = new Map<string, number>();
    const missingGamesMap = new Map<string, number>();
    const fenCoverageCache = new Map<string, Promise<number>>();
    const fenMissingCache = new Map<string, number>();
    const dbMovesCache = new Map<
        string,
        Promise<{ moves: { move: string; games: number }[]; total: number }>
    >();

    async function getDbMoves(
        fen: string,
    ): Promise<{ moves: { move: string; games: number }[]; total: number }> {
        const position = positionKey(fen);
        if (dbMovesCache.has(position)) {
            return dbMovesCache.get(position)!;
        }

        const promise = (async () => {
            signal?.throwIfAborted();
            try {
                const [openings] = await searchPosition(
                    {
                        path: dbPath,
                        position: { fen, type_: "exact" },
                    },
                    "coverage-calc",
                );
                signal?.throwIfAborted();

                const summary = openings.find((op) => op.move === "*");
                const moves = openings
                    .filter((op) => op.move !== "*")
                    .map((op) => ({
                        move: op.move,
                        games: op.total,
                    }));

                const gamesEndingHere = summary?.total ?? 0;

                const gamesContinuing = moves.reduce((acc, m) => acc + m.games, 0);

                const total = gamesEndingHere + gamesContinuing;

                return { moves, total };
            } catch {
                signal?.throwIfAborted();
                return { moves: [], total: 0 };
            }
        })();

        dbMovesCache.set(position, promise);
        return promise;
    }

    async function compute(node: TreeNode, path: number[]): Promise<number> {
        signal?.throwIfAborted();

        const pathKey = path.join(",");
        const position = positionKey(node.fen);

        // A leaf that transposes into an already computed position takes its coverage. A node with
        // moves below it is walked again so those moves get their own entries; its searches are
        // already in dbMovesCache.
        if (node.children.length === 0 && fenCoverageCache.has(position)) {
            const cachedCoverage = await fenCoverageCache.get(position)!;
            coverageMap.set(pathKey, cachedCoverage);
            // Reuse cached db results instead of re-searching
            if (dbMovesCache.has(position)) {
                const { total } = await dbMovesCache.get(position)!;
                gamesMap.set(pathKey, total);
            }
            missingGamesMap.set(pathKey, fenMissingCache.get(position) ?? 0);
            return cachedCoverage;
        }

        const promise = computeNode(node, path);
        if (node.children.length > 0 && !fenCoverageCache.has(position)) {
            fenCoverageCache.set(position, promise);
        }
        return promise;
    }

    async function computeNode(node: TreeNode, path: number[]): Promise<number> {
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }

        const pathKey = path.join(",");
        const position = positionKey(node.fen);

        const { moves: dbMoves, total: totalGames } = await getDbMoves(node.fen);
        gamesMap.set(pathKey, totalGames);

        if (totalGames < minGames) {
            coverageMap.set(pathKey, 1);
            missingGamesMap.set(pathKey, 0);
            fenMissingCache.set(position, 0);
            return 1;
        }

        const isOpponentTurn = node.halfMoves % 2 !== userParity;

        if (isOpponentTurn) {
            if (node.children.length === 0) {
                const partialCoverage = Math.min(minGames / totalGames, 1);
                coverageMap.set(pathKey, partialCoverage);
                const maxMissing = dbMoves
                    .filter((m) => m.games >= minGames)
                    .reduce((max, m) => Math.max(max, m.games), 0);
                missingGamesMap.set(pathKey, maxMissing);
                fenMissingCache.set(position, maxMissing);
                return partialCoverage;
            }
            const significantMoves = dbMoves.filter((m) => m.games >= minGames);
            const significantTotal = significantMoves.reduce((acc, m) => acc + m.games, 0);

            if (significantTotal === 0) {
                coverageMap.set(pathKey, 1);
                missingGamesMap.set(pathKey, 0);
                fenMissingCache.set(position, 0);
                return 1;
            }

            let coverage = 0;
            let maxMissingChildGames = 0;
            for (const dbMove of significantMoves) {
                const childIdx = node.children.findIndex((c) => c.san === dbMove.move);
                if (childIdx !== -1) {
                    const frequency = dbMove.games / significantTotal;
                    const childCoverage = await compute(node.children[childIdx], [
                        ...path,
                        childIdx,
                    ]);
                    coverage += frequency * childCoverage;
                } else {
                    if (dbMove.games > maxMissingChildGames) {
                        maxMissingChildGames = dbMove.games;
                    }
                }
            }
            coverageMap.set(pathKey, coverage);
            missingGamesMap.set(pathKey, maxMissingChildGames);
            fenMissingCache.set(position, maxMissingChildGames);
            return coverage;
        }
        if (node.children.length === 0) {
            coverageMap.set(pathKey, 0);
            missingGamesMap.set(pathKey, totalGames);
            fenMissingCache.set(position, totalGames);
            return 0;
        }
        const childCoverage = await compute(node.children[0], [...path, 0]);
        coverageMap.set(pathKey, childCoverage);
        missingGamesMap.set(pathKey, 0);
        fenMissingCache.set(position, 0);
        return childCoverage;
    }

    // compute() only follows opponent moves that have enough games. A position reached by a rarely
    // played move order is therefore never visited on that path, even when a common move order
    // reaches the same position, and its moves would read as 0% covered. Walk those paths too.
    // Only positions that were already searched are picked up, so a rare line that leads nowhere
    // common stays unsearched.
    async function computeTransposedPaths(node: TreeNode, path: number[]): Promise<void> {
        signal?.throwIfAborted();
        if (!coverageMap.has(path.join(",")) && dbMovesCache.has(positionKey(node.fen))) {
            await compute(node, path);
        }
        // Same rule as the main walk: every opponent move, but only your main reply.
        const isOpponentTurn = node.halfMoves % 2 !== userParity;
        const followed = isOpponentTurn ? node.children.length : Math.min(node.children.length, 1);
        for (let i = 0; i < followed; i++) {
            await computeTransposedPaths(node.children[i], [...path, i]);
        }
    }

    const startNode = getNodeAtPath(root, startPath);
    await compute(startNode, startPath);
    // The gap buttons follow the main walk only: a gap reached through a rare move order is the
    // same gap as on the common order, and filling it there would not change the coverage.
    const mainGamesMap = new Map(gamesMap);
    // A sweep can search new positions, which makes paths it already passed eligible, so repeat
    // until nothing new is searched. That keeps the result independent of the order of the lines.
    let searchedBefore: number;
    do {
        searchedBefore = dbMovesCache.size;
        await computeTransposedPaths(startNode, startPath);
    } while (dbMovesCache.size > searchedBefore);
    return { coverageMap, gamesMap: mainGamesMap, missingGamesMap };
}

export function findNextGap(
    root: TreeNode,
    startPath: number[],
    userColor: "white" | "black",
    coverageMap: Map<string, number>,
    gamesMap: Map<string, number>,
    minGames: number,
): number[] | null {
    const userParity = userColor === "white" ? 0 : 1;
    const startNode = getNodeAtPath(root, startPath);

    function findNextInSubtree(node: TreeNode, path: number[]): number[] | null {
        const pathKey = path.join(",");
        const coverage = coverageMap.get(pathKey) ?? 0;
        const games = gamesMap.get(pathKey) ?? 0;

        if (coverage >= 1 || games < minGames) {
            return null;
        }

        const isUserTurn = node.halfMoves % 2 === userParity;

        for (let i = 0; i < node.children.length; i++) {
            const result = findNextInSubtree(node.children[i], [...path, i]);
            if (result) return result;
        }

        if (path.length > startPath.length) {
            if (isUserTurn && node.children.length === 0) {
                return path;
            }

            if (!isUserTurn) {
                return path;
            }
        }

        return null;
    }

    return findNextInSubtree(startNode, startPath);
}

export function findBiggestGap(
    root: TreeNode,
    userColor: "white" | "black",
    coverageMap: Map<string, number>,
    gamesMap: Map<string, number>,
    missingGamesMap: Map<string, number>,
    minGames: number,
    startPath: number[] = [],
): number[] | null {
    const userParity = userColor === "white" ? 0 : 1;
    const startNode = getNodeAtPath(root, startPath);

    let maxMissing = -1;
    let bestPath: number[] | null = null;

    function traverse(node: TreeNode, path: number[]): boolean {
        const pathKey = path.join(",");
        const coverage = coverageMap.get(pathKey) ?? 0;
        const games = gamesMap.get(pathKey) ?? 0;
        const missing = missingGamesMap.get(pathKey) ?? 0;

        if (coverage >= 1 || games < minGames) {
            return false;
        }

        const isUserTurn = node.halfMoves % 2 === userParity;

        let childHasGap = false;
        for (let i = 0; i < node.children.length; i++) {
            const hasGap = traverse(node.children[i], [...path, i]);
            if (hasGap) {
                childHasGap = true;
            }
        }

        if (path.length > startPath.length) {
            let isGap = false;
            if (isUserTurn && node.children.length === 0) {
                isGap = true;
            } else if (!isUserTurn && !childHasGap) {
                isGap = true;
            }

            if (isGap) {
                if (missing > maxMissing) {
                    maxMissing = missing;
                    bestPath = path;
                } else if (missing === maxMissing && bestPath !== null) {
                    if (path.length < bestPath.length) {
                        bestPath = path;
                    }
                }
            }
        }

        return true;
    }

    traverse(startNode, startPath);
    return bestPath;
}

function getTreeStats(root: TreeNode) {
    const iterator = treeIterator(root);
    const tree = Array.from(iterator);
    const total = tree.length - 1;
    const leafs = tree.filter((item) => item.node.children.length === 0).length;
    const depth = tree.reduce((acc, item) => {
        if (item.position.length > acc) {
            return item.position.length;
        }
        return acc;
    }, 0);
    return { total, leafs, depth };
}

export const getStats = memoize((store: TreeStoreState) => getTreeStats(store.root));
