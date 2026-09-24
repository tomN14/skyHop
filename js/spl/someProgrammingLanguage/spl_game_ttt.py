"""Tic-tac-toe optimal move (minimax) shared by interpreter and optional lib/tic_ai.spl shim."""

_TT_LINES = (
    (0, 1, 2),
    (3, 4, 5),
    (6, 7, 8),
    (0, 3, 6),
    (1, 4, 7),
    (2, 5, 8),
    (0, 4, 8),
    (2, 4, 6),
)


def _tt_winner(bd):
    for a, b, c in _TT_LINES:
        v = bd[a]
        if v != 0 and v == bd[b] == bd[c]:
            return v
    return 0


def _tt_minimax(bd, mx, ai, hu):
    """mx 1 = maximize for ai; 0 = minimize (opponent to move)."""
    w = _tt_winner(bd)
    if w:
        return 100 if w == ai else -100
    if all(bd):
        return 0
    if mx == 1:
        best = -1000
        for i in range(9):
            if bd[i] == 0:
                bd[i] = ai
                best = max(best, _tt_minimax(bd, 0, ai, hu))
                bd[i] = 0
        return best
    worst = 1000
    for i in range(9):
        if bd[i] == 0:
            bd[i] = hu
            worst = min(worst, _tt_minimax(bd, 1, ai, hu))
            bd[i] = 0
    return worst


def _tt_minimax_fast(bd, mx, ai, hu, depth=0):
    """Like minimax but prefers faster wins (100 - depth) and slower losses (-100 + depth)."""
    w = _tt_winner(bd)
    if w:
        if w == ai:
            return 100 - depth
        return -100 + depth
    if all(bd):
        return 0
    if mx == 1:
        best = -1000
        for i in range(9):
            if bd[i] == 0:
                bd[i] = ai
                best = max(best, _tt_minimax_fast(bd, 0, ai, hu, depth + 1))
                bd[i] = 0
        return best
    worst = 1000
    for i in range(9):
        if bd[i] == 0:
            bd[i] = hu
            worst = min(worst, _tt_minimax_fast(bd, 1, ai, hu, depth + 1))
            bd[i] = 0
    return worst


def _validate_ttt_board(board, ai, hu, api_name):
    if not isinstance(board, list) or len(board) != 9:
        raise Exception(f"{api_name}: board must be a list of length 9")
    bd = [int(board[i]) for i in range(9)]
    a, h = int(ai), int(hu)
    for x in bd:
        if x not in (0, 1, 2):
            raise Exception(f"{api_name}: cell values must be 0, 1, or 2")
    if a not in (1, 2) or h not in (1, 2) or a == h:
        raise Exception(f"{api_name}: ai and hu must be 1 and 2 in some order")
    return bd, a, h


def _tt_human_instant_wins(bd, hu):
    """Empty squares where hu wins by playing there on the current board."""
    wins = []
    for i in range(9):
        if bd[i] == 0:
            bd[i] = hu
            if _tt_winner(bd) == hu:
                wins.append(i)
            bd[i] = 0
    return wins


def _tt_human_setup_threats(bd, hu):
    """Lines where hu has two marks and one empty (one move from winning)."""
    n = 0
    for a, b, c in _TT_LINES:
        row = (bd[a], bd[b], bd[c])
        if row.count(hu) == 2 and row.count(0) == 1:
            n += 1
    return n


def _tt_minimax_lose(bd, mx, ai, hu, depth=0):
    """Minimax scores when AI wants to lose: human wins fast, avoid AI wins and draws."""
    w = _tt_winner(bd)
    if w == ai:
        return 10000 + depth
    if w == hu:
        return -10000 - depth
    if all(bd):
        return 800
    if mx == 1:
        best = 100000
        for i in range(9):
            if bd[i] == 0:
                bd[i] = ai
                best = min(best, _tt_minimax_lose(bd, 0, ai, hu, depth + 1))
                bd[i] = 0
        return best
    worst = -100000
    for i in range(9):
        if bd[i] == 0:
            bd[i] = hu
            worst = max(worst, _tt_minimax_lose(bd, 1, ai, hu, depth + 1))
            bd[i] = 0
    return worst


def _tt_score_lose_candidate(bd, ai, hu, move):
    """Lower is better: refuse blocks/wins, chase human forks and fast losses."""
    if bd[move] != 0:
        return 999999
    block_squares = set(_tt_human_instant_wins(bd, hu))
    bd[move] = ai
    if _tt_winner(bd) == ai:
        bd[move] = 0
        return 90000
    hu_wins_next = len(_tt_human_instant_wins(bd, hu))
    hu_setups = _tt_human_setup_threats(bd, hu)
    mm = _tt_minimax_lose(bd, 0, ai, hu, 1)
    bd[move] = 0
    score = mm
    if move in block_squares:
        score += 50000
    score -= hu_wins_next * 8000
    score -= hu_setups * 400
    #comment: Edges are weaker replies than center/corners — prefer them when trying to throw the game.
    if move in (1, 3, 5, 7):
        score -= 120
    if move == 4:
        score += 250
    return score


def _pick_lose_move(bd, ai, hu):
    best_s, best_i = 999999, -1
    for i in range(9):
        if bd[i] == 0:
            s = _tt_score_lose_candidate(bd, ai, hu, i)
            if s < best_s:
                best_s, best_i = s, i
    return best_i


def _pick_best_move(bd, ai, hu, score_fn, pick_highest):
    best_s, best_i = (-1001 if pick_highest else 1001), -1
    for i in range(9):
        if bd[i] == 0:
            bd[i] = ai
            s = score_fn(bd, 0, ai, hu)
            bd[i] = 0
            if pick_highest:
                if s > best_s:
                    best_s, best_i = s, i
            elif s < best_s:
                best_s, best_i = s, i
    return best_i


def tic_best_move(board, ai, hu):
    """
    Minimax: best empty cell index (0–8) for player ``ai``.
    Board: nine cells — 0 empty, 1 = X, 2 = O. Returns -1 if no legal move.
    """
    bd, a, h = _validate_ttt_board(board, ai, hu, "game.ticBestMove")
    return _pick_best_move(bd, a, h, _tt_minimax, pick_highest=True)


def tic_fastest_win_move(board, ai, hu):
    """
    Minimax that prefers the fastest win (fewest moves to checkmate).
    Same board / return conventions as ``tic_best_move``.
    """
    bd, a, h = _validate_ttt_board(board, ai, hu, "game.ticFastestWinMove")

    def score(bd, mx, ai, hu):
        return _tt_minimax_fast(bd, mx, ai, hu, 0)

    return _pick_best_move(bd, a, h, score, pick_highest=True)


def tic_lose_move(board, ai, hu):
    """
    Aggressively tries to lose: never blocks an immediate human win if avoidable,
    never takes an accidental AI win if avoidable, sets up human forks, and uses
    inverted depth-aware minimax to hand the game over as fast as possible.
    """
    bd, a, h = _validate_ttt_board(board, ai, hu, "game.ticLoseMove")
    return _pick_lose_move(bd, a, h)
