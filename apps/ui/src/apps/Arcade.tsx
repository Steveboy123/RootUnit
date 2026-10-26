import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw } from 'lucide-react';
import { Banner, Page, Panel, Segment, Stat, Stats } from '../components/ui';
import { readBest, recordBest } from '../lib/arcade/best';
import { play, start2048, type Dir, type Game2048 } from '../lib/arcade/game2048';
import { newSnake, step, tickMs, turn, type Heading, type Snake } from '../lib/arcade/snake';
import { keyDir, swipeDir } from '../lib/arcade/swipe';

type Which = '2048' | 'snake';

/** Arrow keys and WASD steer whichever game is open. Not while typing in a box. */
function useDirectionKeys(onDir: (d: Dir) => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const d = keyDir(e);
      if (!d) return;
      e.preventDefault();
      onDir(d);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onDir]);
}

/** Swipe on a surface to give a direction. The pointer is captured so a swipe that drifts off the board still counts. */
function useSwipe(onDir: (d: Dir) => void) {
  const from = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      from.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const a = from.current;
      from.current = null;
      if (!a) return;
      const d = swipeDir(e.clientX - a.x, e.clientY - a.y);
      if (d) onDir(d);
    },
    onPointerCancel: () => {
      from.current = null;
    },
  };
}

function DPad({ onDir }: { onDir: (d: Dir) => void }) {
  const btn = (d: Dir, Icon: typeof ChevronUp, label: string) => (
    <button type="button" className={`ar-key ar-key-${d}`} aria-label={label} onClick={() => onDir(d)}>
      <Icon size={30} />
    </button>
  );
  return (
    <div className="ar-pad" role="group" aria-label="Direction buttons">
      {btn('up', ChevronUp, 'Up')}
      {btn('left', ChevronLeft, 'Left')}
      {btn('right', ChevronRight, 'Right')}
      {btn('down', ChevronDown, 'Down')}
    </div>
  );
}

const levelOf = (v: number) => (v === 0 ? 0 : Math.min(12, Math.log2(v)));

function Game2048() {
  const [g, setG] = useState<Game2048>(() => start2048(Math.random));
  const [best, setBest] = useState(() => readBest('2048'));
  const [carryOn, setCarryOn] = useState(false);
  const ref = useRef(g);

  const move = useCallback((d: Dir) => {
    const next = play(ref.current, d, Math.random);
    if (next === ref.current) return;
    ref.current = next;
    setG(next);
    setBest(recordBest('2048', next.score));
  }, []);
  const restart = () => {
    ref.current = start2048(Math.random);
    setG(ref.current);
    setCarryOn(false);
  };
  useDirectionKeys(move);
  const swipe = useSwipe(move);

  return (
    <div className="ar-play">
      <div className="ar-stage">
        <div className="ar-board ar-2048" data-no-swipe {...swipe} role="grid" aria-label="2048 board. Swipe to slide the tiles.">
          {g.board.flat().map((v, i) => (
            <div key={i} className="ar-cell" role="gridcell" aria-label={v ? String(v) : 'empty'}>
              {v > 0 && (
                <span key={v} className="ar-tile" data-lv={levelOf(v)}>
                  {v}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="ar-side">
        <Stats cols={2}>
          <Stat label="Score" value={g.score} />
          <Stat label="Best" value={best} />
        </Stats>
        {g.over && <Banner tone="warn">No moves left. Start again?</Banner>}
        {g.won && !g.over && !carryOn && (
          <Banner tone="ok" action={<button type="button" className="btn small" onClick={() => setCarryOn(true)}>Keep going</button>}>
            You made 2048!
          </Banner>
        )}
        <DPad onDir={move} />
        <button type="button" className="btn" onClick={restart}>
          <RotateCcw size={16} /> New game
        </button>
      </div>
    </div>
  );
}

const SNAKE_W = 20;
const SNAKE_H = 12;

function SnakeGame() {
  const [s, setS] = useState<Snake>(() => newSnake(SNAKE_W, SNAKE_H, Math.random));
  const [running, setRunning] = useState(false);
  const [best, setBest] = useState(() => readBest('snake'));
  const ref = useRef(s);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const next = step(ref.current, Math.random);
      ref.current = next;
      setS(next);
      if (!next.alive || next.won) {
        setRunning(false);
        setBest(recordBest('snake', next.score));
      }
    }, tickMs(s.score));
    return () => window.clearInterval(id);
  }, [running, s.score]);

  const steer = useCallback((d: Dir) => {
    if (!ref.current.alive) return;
    const next = turn(ref.current, d as Heading);
    ref.current = next;
    setS(next);
    setRunning(true); // the first move starts the game
  }, []);
  const restart = () => {
    ref.current = newSnake(SNAKE_W, SNAKE_H, Math.random);
    setS(ref.current);
    setRunning(false);
  };
  useDirectionKeys(steer);
  const swipe = useSwipe(steer);

  const head = s.body[0]!;
  return (
    <div className="ar-play">
      <div className="ar-stage">
        <svg className="ar-board ar-snake" viewBox={`0 0 ${SNAKE_W} ${SNAKE_H}`} data-no-swipe {...swipe} role="img" aria-label={`Snake. Score ${s.score}. Swipe to steer.`}>
          <rect className="ar-snake-bg" width={SNAKE_W} height={SNAKE_H} rx="0.4" />
          {s.food && <circle className="ar-food fx" cx={s.food.x + 0.5} cy={s.food.y + 0.5} r="0.36" />}
          {s.body.slice(1).map((p, i) => (
            <rect key={i} className="ar-seg" x={p.x + 0.06} y={p.y + 0.06} width="0.88" height="0.88" rx="0.22" />
          ))}
          <rect className="ar-seg ar-head" x={head.x + 0.02} y={head.y + 0.02} width="0.96" height="0.96" rx="0.3" />
        </svg>
      </div>
      <div className="ar-side">
        <Stats cols={2}>
          <Stat label="Length" value={s.body.length} />
          <Stat label="Best" value={best} />
        </Stats>
        {!s.alive && <Banner tone="warn">Crashed with {s.score} eaten.</Banner>}
        {s.won && <Banner tone="ok">You filled the whole board!</Banner>}
        {s.alive && !running && s.score === 0 && <div className="dim small">Swipe or tap an arrow to start.</div>}
        <DPad onDir={steer} />
        <div className="row wrap">
          {s.alive && s.score + s.body.length > 3 && (
            <button type="button" className="btn" onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Resume'}
            </button>
          )}
          <button type="button" className="btn" onClick={restart}>
            <RotateCcw size={16} /> New game
          </button>
        </div>
      </div>
    </div>
  );
}

/** Two small games for the time spent waiting. Locked while the car is moving (see the app registry). */
export function ArcadeApp() {
  const [which, setWhich] = useState<Which>('2048');
  return (
    <Page subtitle="For when you are parked and waiting.">
      <Segment<Which>
        label="Game"
        value={which}
        options={[
          { value: '2048', label: '2048' },
          { value: 'snake', label: 'Snake' },
        ]}
        onChange={setWhich}
      />
      <Panel>{which === '2048' ? <Game2048 /> : <SnakeGame />}</Panel>
    </Page>
  );
}
