import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Pool } from "pg";

import { ACCOUNT_REJECTION_SCHEMA_VERSION, type AccountRejection } from "@gooddealer/protocol/account";

import { AccountTransactionRunner, IdentityCapabilityTransactionRunner, TenantTransactionRunner } from "../db/index";
import {
  CommercialCheckoutApplicationService,
  CommercialCheckoutCreationRejectedError,
  CommercialCheckoutCreationUnknownError,
  CommercialCheckoutUnavailableError,
  CommercialPurchaseConflictError,
  PostgresCommercialAggregateRepository,
  ProviderDispatchExecutor,
  type CommercialCheckoutApplicationPort,
  type CommercialCheckoutCatalog,
  type CommercialProviderMutationGateway,
} from "../modules/licensing/index";
import {
  AccountActivationApplicationService,
  type AccountActivationSubjectReaderPort,
} from "../modules/identity/index";
import { IdentityAccountSessionVerifier, type IdentitySessionVerificationReader } from "../modules/identity/index";
import { PostgresDefaultWorkspaceTenantResolver } from "../modules/workspace/default-workspace/index";
import { PostgresMutationAuthority } from "../modules/devices/postgres-mutation-authority";
import { PostgresDesktopSyncAuthority } from "../modules/devices/postgres-sync-authority";
import { PostgresWorkspaceCheckpointReader } from "../modules/workspace/checkpoints/postgres-reader";
import { PostgresReaderCursorRepository } from "../modules/workspace/cursors/postgres-reader-cursor-repository";
import { PostgresReaderCursorService } from "../modules/workspace/cursors/postgres-reader-cursor-service";
import { PostgresWorkspaceMutationIngest } from "../modules/workspace/mutations/postgres-ingest-service";
import { PostgresReaderMutationPage } from "../modules/workspace/mutations/postgres-reader-page";
import { PostgresWorkspaceMutationRepository } from "../modules/workspace/mutations/postgres-repository";
import { PostgresWorkspaceRevisionRepository } from "../modules/workspace/revisions/postgres-repository";
import { PostgresPortfolioRepository } from "../modules/workspace/state/portfolio/postgres-repository";
import { PostgresWorkspaceSyncApplication, type WorkspaceSyncApplicationPort } from "../modules/workspace/sync/http-service";
import {
  PostgresCloudflareDnsObservationIngress,
  type CloudflareDnsObservationIngressPort,
} from "../modules/workspace/sync/cloudflare-observation";
import { assignCorrelationId, correlationIdFor } from "./adapter/correlation";
import {
  rateLimitedRejection,
  sendAccountRejection,
  sendNotFound,
  sendTransportRejection,
} from "./adapter/error-identity";
import {
  InMemoryFixedWindowRateLimiter,
  cookieValue,
  preAuthRateLimitIdentity,
  sessionRateLimitIdentity,
  trustLoopbackProxy,
  type RateLimitPolicy,
} from "./adapter/rate-limit";
import { attachOpenApiDocument, buildOpenApiDocument } from "./adapter/schema";
import { registerPublicRoutes, routePrincipal, setRoutePrincipal } from "./adapter/surface";
import type { AccountActivationApplicationPort } from "./ports/account-activation";
import {
  DenyingDesktopAuthorizationApplicationPort,
  type DesktopAuthorizationApplicationPort,
} from "./ports/desktop-authorization";
import {
  DesktopAuthorizationGrantIssuer,
  PostgresDesktopAuthorizationApplicationService,
  type ActiveDeviceLeaseVerifier,
  type DesktopAuthorizationGrantSigner,
} from "../modules/devices/index";
import {
  bearerToken,
  CloudPublicSessionVerifier,
  DenyingDesktopAccessTokenVerifier,
  PUBLIC_SESSION_COOKIE,
  type DesktopAccessTokenVerifierPort,
  type PublicSessionVerifierPort,
} from "./ports/public-session";
import {
  createPublicBusinessRoutes,
  publicBoundaryRoutes,
  PublicRouteAuthorizationError,
} from "./routes/public/boundary";

export interface PublicApplicationPorts {
  readonly accountActivation: AccountActivationApplicationPort;
  readonly desktopAuthorization: DesktopAuthorizationApplicationPort;
  readonly commercialCheckout: CommercialCheckoutApplicationPort;
  readonly workspaceSync?: WorkspaceSyncApplicationPort;
  readonly cloudflareDnsObservation?: CloudflareDnsObservationIngressPort;
}

export interface PublicHttpDependencies {
  readonly sessions: PublicSessionVerifierPort;
  readonly preAuthRateLimit: RateLimitPolicy;
  readonly sessionRateLimit: RateLimitPolicy;
  readonly now: () => Date;
  readonly correlationIds: () => string;
  readonly ports: PublicApplicationPorts;
  readonly desktopAccessTokens?: DesktopAccessTokenVerifierPort;
}

export interface CloudPublicHttpDependencies extends Omit<PublicHttpDependencies, "sessions"> {
  readonly identity: IdentitySessionVerificationReader;
}

export interface PostgresCloudPublicHttpDependencies
  extends Omit<CloudPublicHttpDependencies, "ports" | "desktopAccessTokens"> {
  readonly pool: Pool;
  readonly accountApiPool?: Pool;
  /** Separate Identity-only credential; never share the account API pool credential here. */
  readonly identityCapabilityIssuerPool?: Pool;
  /** Provider mutations and bound work run only through the dedicated worker login. */
  readonly providerWorkerPool?: Pool;
  /** Explicitly test-only compatibility for PostgreSQL activation fixtures predating role setup. */
  readonly allowSelectorOnlyIdentityTestHarness?: true;
  readonly activationSubjects: AccountActivationSubjectReaderPort;
  readonly desktopAuthorizationSigner: DesktopAuthorizationGrantSigner;
  readonly activeDeviceLeaseVerifier: ActiveDeviceLeaseVerifier;
  readonly desktopAccessTokens: DesktopAccessTokenVerifierPort;
  readonly commercialCheckoutCatalog: CommercialCheckoutCatalog;
  readonly commercialCheckoutGateways: readonly CommercialProviderMutationGateway[];
  readonly workspaceSyncTokenKey?: Uint8Array;
}

export const PUBLIC_BODY_LIMIT_BYTES = 256;
export const PUBLIC_MAX_URL_LENGTH = 2_048;
export const BILLING_APPROVAL_ROUTE = "/billing/approval/:handle" as const;

/** Production composition always resolves the public seam from live identity state. */
export function createCloudPublicHttp(deps: CloudPublicHttpDependencies): FastifyInstance {
  const { identity, ...http } = deps;
  return createPublicHttp({
    ...http,
    sessions: new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier(identity)),
  });
}

/** Production composition binds the authenticated HTTP surface to PostgreSQL-owned services. */
export function createPostgresCloudPublicHttp(
  deps: PostgresCloudPublicHttpDependencies,
): FastifyInstance {
  const {
    pool,
    accountApiPool,
    identityCapabilityIssuerPool,
    providerWorkerPool,
    allowSelectorOnlyIdentityTestHarness,
    activationSubjects,
    desktopAuthorizationSigner,
    activeDeviceLeaseVerifier,
    commercialCheckoutCatalog,
    commercialCheckoutGateways,
    workspaceSyncTokenKey,
    ...http
  } = deps;
  const hasAuthenticatedPools = identityCapabilityIssuerPool !== undefined && accountApiPool !== undefined;
  const hasPartialAuthenticatedPools = (identityCapabilityIssuerPool === undefined) !== (accountApiPool === undefined);
  if (hasPartialAuthenticatedPools || ((!hasAuthenticatedPools || providerWorkerPool === undefined)
      && allowSelectorOnlyIdentityTestHarness !== true)) {
    throw new TypeError("authenticated PostgreSQL capability pools are required");
  }
  const accountTransactions = new AccountTransactionRunner(pool);
  const identityTransactions = accountApiPool === undefined || identityCapabilityIssuerPool === undefined
    ? undefined
    : new IdentityCapabilityTransactionRunner(accountApiPool, identityCapabilityIssuerPool);
  const authenticatedTransactions = identityTransactions ?? accountTransactions;
  const workspaces = new PostgresDefaultWorkspaceTenantResolver(authenticatedTransactions);
  const desktopAuthorization = identityTransactions === undefined
    ? new DenyingDesktopAuthorizationApplicationPort()
    : new PostgresDesktopAuthorizationApplicationService(
      identityTransactions,
      workspaces,
      new DesktopAuthorizationGrantIssuer(desktopAuthorizationSigner),
      activeDeviceLeaseVerifier,
    );
  let commercialCheckout: CommercialCheckoutApplicationPort = denyingCommercialCheckout;
  if (identityTransactions !== undefined && providerWorkerPool !== undefined) {
    const commercialRepository = new PostgresCommercialAggregateRepository();
    const dispatch = new ProviderDispatchExecutor(
      providerWorkerPool,
      commercialRepository,
      commercialCheckoutGateways,
      deps.now,
    );
    commercialCheckout = new CommercialCheckoutApplicationService(
      identityTransactions,
      providerWorkerPool,
      commercialRepository,
      commercialCheckoutCatalog,
      dispatch,
      deps.now,
    );
  }
  const workspaceSync = workspaceSyncTokenKey === undefined ? undefined : (() => {
    const tenantTransactions = new TenantTransactionRunner(pool);
    const revisions = new PostgresWorkspaceRevisionRepository();
    const mutations = new PostgresWorkspaceMutationRepository();
    const readers = new PostgresReaderCursorService({
      transactions: tenantTransactions,
      revisions,
      cursors: new PostgresReaderCursorRepository(),
      pages: new PostgresReaderMutationPage(mutations),
      tokenKey: workspaceSyncTokenKey,
    });
    return new PostgresWorkspaceSyncApplication({
      authority: new PostgresDesktopSyncAuthority(accountTransactions),
      workspaces,
      mutations: new PostgresWorkspaceMutationIngest({
        transactions: tenantTransactions,
        authority: new PostgresMutationAuthority(),
        revisions,
        portfolio: new PostgresPortfolioRepository(),
        mutations,
      }),
      readers,
      checkpoints: new PostgresWorkspaceCheckpointReader(tenantTransactions),
    });
  })();
  return createCloudPublicHttp({
    ...http,
    ports: {
      accountActivation: new AccountActivationApplicationService(
        pool,
        activationSubjects,
        workspaces,
      ),
      desktopAuthorization,
      commercialCheckout,
      ...(workspaceSync === undefined ? {} : { workspaceSync }),
      ...(identityTransactions === undefined ? {} : {
        cloudflareDnsObservation: new PostgresCloudflareDnsObservationIngress({
          transactions: identityTransactions,
          workspaces,
        }),
      }),
    },
  });
}

const denyingCommercialCheckout: CommercialCheckoutApplicationPort = {
  async createCheckout() { return null; },
  async readStatus() { return null; },
  async cancelSubscription() { return null; },
  async confirmFixedTerm() { return null; },
  async requestFirstPurchaseRefund() { return null; },
  async readFirstPurchaseRefundStatus() { return null; },
  async claimApprovalRedirect() { return null; },
};

export function createPublicHttp(deps: PublicHttpDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: PUBLIC_BODY_LIMIT_BYTES,
    trustProxy: trustLoopbackProxy,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const preAuthLimiter = new InMemoryFixedWindowRateLimiter(deps.preAuthRateLimit);
  const sessionLimiter = new InMemoryFixedWindowRateLimiter(deps.sessionRateLimit);
  const desktopAccessTokens = deps.desktopAccessTokens ?? new DenyingDesktopAccessTokenVerifier();
  const routes = [...publicBoundaryRoutes, ...createPublicBusinessRoutes(deps.ports)] as const;

  app.addHook("onRequest", async (request, reply) => {
    assignCorrelationId(request, reply, deps.correlationIds);
  });

  app.addHook("onRequest", async (request, reply) => {
    if ((request.raw.url?.length ?? 0) > PUBLIC_MAX_URL_LENGTH) {
      return sendTransportRejection(request, reply, 413, "PAYLOAD_TOO_LARGE");
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    // A cookie is unverified at this stage and therefore cannot choose a pre-auth bucket.
    const decision = preAuthLimiter.consume(preAuthRateLimitIdentity(request.ip));
    if (!decision.allowed) {
      const rejection: AccountRejection = rateLimitedRejection(
        correlationIdFor(request),
        decision.retryAfterSeconds ?? 1,
      );
      return sendAccountRejection(reply, rejection);
    }
  });

  // Fastify validates immediately after preValidation; preHandler would authenticate too late.
  app.addHook("preValidation", async (request, reply) => {
    const sessionId = cookieValue(request.headers.cookie, PUBLIC_SESSION_COOKIE);
    const accessToken = bearerToken(request.headers.authorization);
    // Credential ambiguity is rejected instead of allowing one credential to shadow another.
    if (sessionId !== null && accessToken !== null) {
      return sendTransportRejection(request, reply, 401, "UNAUTHENTICATED");
    }
    const evaluatedAt = deps.now();
    const principal = accessToken === null
      ? await deps.sessions.verify(sessionId, evaluatedAt)
      : await desktopAccessTokens.verifyAccessToken(accessToken, evaluatedAt);
    if (principal === null) {
      return sendTransportRejection(request, reply, 401, "UNAUTHENTICATED");
    }
    if ((accessToken === null) !== (principal.clientKind === "account_web")) {
      return sendTransportRejection(request, reply, 401, "UNAUTHENTICATED");
    }
    // Only the verified principal may select this layer; the raw cookie remains address-bucketed.
    const decision = sessionLimiter.consume(sessionRateLimitIdentity(principal.sessionId));
    if (!decision.allowed) {
      const rejection: AccountRejection = rateLimitedRejection(
        correlationIdFor(request),
        decision.retryAfterSeconds ?? 1,
      );
      return sendAccountRejection(reply, rejection);
    }
    setRoutePrincipal(request, principal);
  });

  registerPublicRoutes(app, routes);
  app.get(BILLING_APPROVAL_ROUTE, async (request, reply) => {
    const principal = routePrincipal<import("./ports/public-session").PublicPrincipal>(request);
    const params = request.params as { readonly handle?: unknown };
    if (principal === null || principal.clientKind !== "account_web"
      || request.headers["sec-fetch-site"] !== "same-origin" || typeof params.handle !== "string") {
      return sendNotFound(request, reply);
    }
    const target = await deps.ports.commercialCheckout.claimApprovalRedirect(params.handle, principal);
    if (target === null) return sendNotFound(request, reply);
    return reply.code(303).headers({ location: target, "cache-control": "no-store", "referrer-policy": "no-referrer" }).send();
  });
  attachOpenApiDocument(app, buildOpenApiDocument("GoodDealer Public Boundary", routes));

  app.setNotFoundHandler(async (request, reply) => sendNotFound(request, reply));
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (error instanceof PublicRouteAuthorizationError) {
      return sendNotFound(request, reply);
    }
    if (error instanceof CommercialPurchaseConflictError) {
      return sendAccountRejection(reply, {
        schemaVersion: ACCOUNT_REJECTION_SCHEMA_VERSION,
        code: "COMMERCIAL_PURCHASE_CONFLICT",
        retryable: false,
        retryAfterSeconds: null,
        correlationId: correlationIdFor(request),
      });
    }
    if (error instanceof CommercialCheckoutCreationRejectedError || error instanceof CommercialCheckoutUnavailableError) {
      return sendAccountRejection(reply, {
        schemaVersion: ACCOUNT_REJECTION_SCHEMA_VERSION,
        code: "COMMERCIAL_CHECKOUT_REJECTED",
        retryable: false,
        retryAfterSeconds: null,
        correlationId: correlationIdFor(request),
      });
    }
    if (error instanceof CommercialCheckoutCreationUnknownError) {
      return sendAccountRejection(reply, {
        schemaVersion: ACCOUNT_REJECTION_SCHEMA_VERSION,
        code: "COMMERCIAL_CHECKOUT_OUTCOME_UNKNOWN",
        retryable: true,
        retryAfterSeconds: null,
        correlationId: correlationIdFor(request),
      });
    }
    if (
      error.validation !== undefined
      || error.code === "FST_ERR_VALIDATION"
      || error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
    ) {
      return sendTransportRejection(request, reply, 400, "SCHEMA_INVALID");
    }
    if (error.statusCode === 413) {
      return sendTransportRejection(request, reply, 413, "PAYLOAD_TOO_LARGE");
    }
    if (error.statusCode === 415) {
      return sendTransportRejection(request, reply, 415, "UNSUPPORTED_MEDIA_TYPE");
    }
    return sendTransportRejection(request, reply, 500, "INTERNAL");
  });

  return app;
}
