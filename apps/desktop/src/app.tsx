import { registeredConnectorIds } from "./composition-root";

export function App() {
  return (
    <main>
      <h1>GoodDealer Phase 0</h1>
      <p>Engineering baseline is active.</p>
      <p>Registered connector fixtures: {registeredConnectorIds.join(", ")}</p>
    </main>
  );
}
