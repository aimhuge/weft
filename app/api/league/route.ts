import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { isLimitBoard } from "@/lib/limit-board";
import { limitBoardView } from "@/lib/limit-board-sync";
import { leagueView, tierView } from "@/lib/league-sync";

// Your league this week (the 🏆 chip, the Loom's League tab): posts your week first, then reads the standings.
// ?tier=N reads every league of that tier instead, for the Leagues dialog (lib/league-sync.ts), and ?board= one of
// the limit leaderboards (lib/limit-board-sync.ts).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const params = new URL(req.url).searchParams;
    const board = params.get("board");
    if (board !== null) return isLimitBoard(board) ? Response.json({ board: await limitBoardView(board) }) : fail(new Error("No such board."), 400);
    const tier = params.get("tier");
    if (tier !== null) return Response.json({ tier: await tierView(Number(tier)) });
    return Response.json({ league: await leagueView() });
  } catch (err) {
    return fail(err, 500);
  }
}
