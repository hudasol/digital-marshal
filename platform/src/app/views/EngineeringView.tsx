import { useStore } from '../store';

/* Engineering inspector. Grows with each milestone: simulation state, incidents, message history,
   validation reason codes, vehicle states, configuration, metrics, exports and known limitations. */

export function EngineeringView() {
  const q = useStore((s) => s.effectiveQuality);
  const clock = useStore((s) => s.clock);
  return (
    <div className="view" role="main">
      <div className="view-inner stack">
        <div>
          <h1>Engineering inspector</h1>
          <p className="lede">Raw state of the running session. Values here are read directly from the simulation and renderer.</p>
        </div>
        <div className="grid-3">
          <div className="card">
            <h2>Session</h2>
            <table className="data">
              <tbody>
                <tr>
                  <td>Simulation time</td>
                  <td className="r mono">{clock.t.toFixed(1)} s</td>
                </tr>
                <tr>
                  <td>Playback</td>
                  <td className="r mono">
                    {clock.playing ? 'running' : 'paused'} at {clock.speed}x
                  </td>
                </tr>
                <tr>
                  <td>Graphics tier</td>
                  <td className="r mono">{q}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
