// Lists positions a repertoire PGN reaches by move orders whose FENs differ only in the clocks.
// Usage: bun find-clock-transpositions.ts <chessops dist/esm dir> <file.pgn>
import { readFileSync } from "node:fs";

const [chessopsDir, pgnPath] = process.argv.slice(2);
const { parsePgn, startingPosition } = await import(`${chessopsDir}/pgn.js`);
const { parseSan } = await import(`${chessopsDir}/san.js`);
const { makeFen } = await import(`${chessopsDir}/fen.js`);

type Seen = { line: string; fen: string; replies: string[]; ply: number };
const game = parsePgn(readFileSync(pgnPath, "utf8"))[0];
const byPosition = new Map<string, Seen[]>();

const walk = (node: any, pos: any, sans: string[]) => {
    for (const child of node.children) {
        const move = parseSan(pos, child.data.san);
        if (!move) continue;
        const next = pos.clone();
        next.play(move);
        const line = [...sans, child.data.san];
        const fen = makeFen(next.toSetup());
        const key = fen.split(" ").slice(0, 4).join(" ");
        const list = byPosition.get(key) ?? [];
        list.push({
            line: line.join(" "),
            fen,
            replies: child.children.map((c: any) => c.data.san),
            ply: line.length,
        });
        byPosition.set(key, list);
        walk(child, next, line);
    }
};
walk(game.moves, startingPosition(game.headers).unwrap(), []);

const clockOnly = [...byPosition.values()]
    .filter((list) => new Set(list.map((s) => s.fen)).size > 1)
    .sort((a, b) => a[0].ply - b[0].ply);
const leafMeetsLine = clockOnly.filter(
    (list) => list.some((s) => s.replies.length === 0) && list.some((s) => s.replies.length > 0),
);

console.log(`positions reached with differing clocks: ${clockOnly.length}`);
console.log(
    `  of which a line that ends there meets a line that continues: ${leafMeetsLine.length}`,
);
for (const [title, lists] of [
    ["shallowest clock-only transpositions", clockOnly.slice(0, 8)],
    ["shallowest 'ends here' meets 'continues'", leafMeetsLine.slice(0, 6)],
] as const) {
    console.log(`\n== ${title}`);
    for (const list of lists) {
        console.log(`  ply ${list[0].ply}:`);
        for (const seen of list) {
            const clock = seen.fen.split(" ")[4];
            console.log(
                `    ${seen.line}  [clock ${clock}] -> ${seen.replies.join(", ") || "(ends)"}`,
            );
        }
    }
}
