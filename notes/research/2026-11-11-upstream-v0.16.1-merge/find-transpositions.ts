// Lists positions a repertoire PGN reaches by more than one move order.
// Usage: bun find-transpositions.ts <chessops dist/esm dir> <file.pgn>
import { readFileSync } from "node:fs";

const [chessopsDir, pgnPath] = process.argv.slice(2);
const { parsePgn, startingPosition } = await import(`${chessopsDir}/pgn.js`);
const { parseSan } = await import(`${chessopsDir}/san.js`);
const { makeFen } = await import(`${chessopsDir}/fen.js`);

type Seen = { line: string; replies: string[]; ply: number };
const games = parsePgn(readFileSync(pgnPath, "utf8"));
console.log(`games in file: ${games.length}`);

games.forEach((game: any, gameIndex: number) => {
    const byFen = new Map<string, Seen[]>();
    let nodes = 0;

    const walk = (node: any, pos: any, sans: string[]) => {
        for (const child of node.children) {
            const move = parseSan(pos, child.data.san);
            if (!move) continue;
            const next = pos.clone();
            next.play(move);
            const line = [...sans, child.data.san];
            nodes++;
            const fen = makeFen(next.toSetup());
            const list = byFen.get(fen) ?? [];
            list.push({
                line: line.join(" "),
                replies: child.children.map((c: any) => c.data.san),
                ply: line.length,
            });
            byFen.set(fen, list);
            walk(child, next, line);
        }
    };

    walk(game.moves, startingPosition(game.headers).unwrap(), []);

    const transposed = [...byFen.values()]
        .filter((list) => list.length > 1 && list.filter((s) => s.replies.length > 0).length > 1)
        .sort((a, b) => a[0].ply - b[0].ply);

    console.log(
        `game ${gameIndex + 1}: ${nodes} moves, ${transposed.length} positions reached by 2+ move orders that each continue`,
    );
    for (const list of transposed.slice(0, 6)) {
        console.log(`\n  ply ${list[0].ply}:`);
        for (const seen of list) {
            console.log(`    ${seen.line}   -> then: ${seen.replies.join(", ") || "(nothing)"}`);
        }
    }
});
