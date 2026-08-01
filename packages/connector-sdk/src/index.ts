export interface ConnectorRegistration {
  readonly id: "spaceship" | "cloudflare" | "atom" | "afternic";
  readonly implementation: "fixture";
}
