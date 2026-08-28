import { useEffect, useState } from "react";

import {
  createLocalBusinessPort,
  type LocalBusinessStatus,
  type LocalPortfolioSnapshot,
} from "./adapters/tauri";

const localBusiness = createLocalBusinessPort();

export function App() {
  const [status, setStatus] = useState<LocalBusinessStatus | null>(null);
  const [portfolio, setPortfolio] = useState<LocalPortfolioSnapshot | null>(null);
  const [failure, setFailure] = useState(false);

  useEffect(() => {
    let active = true;
    void localBusiness
      .status()
      .then(async (nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        if (nextStatus.state === "ready") {
          const snapshot = await localBusiness.readPortfolio();
          if (active) setPortfolio(snapshot);
        }
      })
      .catch(() => {
        if (active) setFailure(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (failure) {
    return <Unavailable message="The local business host is unavailable." />;
  }
  if (status === null) {
    return <Unavailable message="Opening the local business database…" />;
  }
  if (status.state === "authorization_required") {
    return <Unavailable message="Sign in and authorize this device to open local business data." />;
  }
  if (portfolio === null) {
    return <Unavailable message="Reading local business data…" />;
  }
  return (
    <main aria-label="GoodDealer Desktop">
      <h1>GoodDealer</h1>
      <p>{portfolio.domains.length} local domain assets</p>
      <ul>
        {portfolio.domains.map((domain) => (
          <li key={domain.entityId}>{domain.entityId}</li>
        ))}
      </ul>
    </main>
  );
}

function Unavailable({ message }: { readonly message: string }) {
  return (
    <main aria-label="GoodDealer Desktop">
      <h1>GoodDealer</h1>
      <p>{message}</p>
    </main>
  );
}
