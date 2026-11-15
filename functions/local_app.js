
"use strict";

const express = require("express");
const { manageJob } = require("./job_management");
const { manageAccount, ManagementError } = require("./management");
const verification = require("./verification_management");

const HOST = "127.0.0.1";
const PORT = 8787;
const ORIGIN = "http://localhost:5174";

const API_PATH = "/api/accounts/manage";
const JOB_PATH = "/api/jobs/soft-delete";

const VERIFICATION_QUEUE_PATH = "/api/verification/queue";
const VERIFICATION_DETAILS_PATH = "/api/verification/details";
const VERIFICATION_REVIEW_PATH = "/api/verification/review";
const VERIFICATION_DOCUMENT_PATH = "/api/verification/document";

function createSerialExecutor() {
  let tail = Promise.resolve();
  let pending = 0;

  return (task) => {
    if (pending >= 32) {
      return Promise.reject(
        Object.assign(new Error("Busy"), {
          code: "resource-exhausted",
        })
      );
    }

    pending++;

    const next = tail.then(task);
    tail = next.catch(() => {});

    return next.finally(() => {
      pending--;
    });
  };
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isValidUid(uid) {
  return (
    typeof uid === "string" &&
    uid.length >= 1 &&
    uid.length <= 128 &&
    !uid.includes("/")
  );
}

function getBearerToken(req) {
  const authorization = req.headers.authorization;

  if (typeof authorization !== "string") {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : null;
}

function getErrorStatus(code) {
  const statuses = {
    "permission-denied": 403,
    unauthenticated: 401,
    "invalid-argument": 400,
    "not-found": 404,
    "failed-precondition": 409,
    "already-exists": 409,
    "resource-exhausted": 429,
    unavailable: 503,
  };

  return statuses[code] || 409;
}

function createLocalApp({
  auth,
  db,
  bucket = null,
  manager = manageAccount,
  verificationManager = verification,
  demoPolicy = null,
}) {
  const app = express();
  const serialized = createSerialExecutor();

  app.disable("x-powered-by");
  app.set("trust proxy", false);

  const reject = (res, status, code, message) => {
    return res.status(status).json({
      error: {
        code,
        message,
      },
    });
  };

  // Create the private document handler once.
  const documentHandler = bucket
    ? verificationManager.createVerificationDocumentHandler({
        auth,
        db,
        bucket,
        allowedOrigins: [ORIGIN],
      })
    : null;

  // ---------------------------------------------------------------------------
  // Security headers, Host validation, Origin validation and CORS
  // ---------------------------------------------------------------------------

  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'"
    );

    const headerCount = (key) =>
      req.rawHeaders.filter(
        (_, index) =>
          index % 2 === 0 &&
          req.rawHeaders[index].toLowerCase() === key
      ).length;

    if (
      headerCount("host") !== 1 ||
      req.headers.host !== `${HOST}:${PORT}`
    ) {
      return reject(
        res,
        403,
        "permission-denied",
        "Invalid Host."
      );
    }

    if (headerCount("authorization") > 1) {
      return reject(
        res,
        400,
        "invalid-argument",
        "Duplicate Authorization headers."
      );
    }

    const origin = req.headers.origin;

    if (
      headerCount("origin") > 1 ||
      (origin !== undefined && origin !== ORIGIN)
    ) {
      return reject(
        res,
        403,
        "permission-denied",
        "Origin not allowed."
      );
    }

    if (origin === ORIGIN) {
      res.set("Access-Control-Allow-Origin", ORIGIN);
      res.vary("Origin");
    }

    // Health endpoint is the only route that does not require the browser
    // Origin header.
    if (req.method === "GET" && req.path === "/health") {
      return next();
    }

    if (origin !== ORIGIN) {
      return reject(
        res,
        403,
        "permission-denied",
        "An approved browser origin is required."
      );
    }

    // CORS preflight.
    if (req.method === "OPTIONS") {
      const requestedMethod =
        req.headers["access-control-request-method"];

      const requestedHeaders = String(
        req.headers["access-control-request-headers"] || ""
      )
        .toLowerCase()
        .split(",")
        .map((header) => header.trim())
        .filter(Boolean);

      const postPaths = [
        API_PATH,
        JOB_PATH,
        VERIFICATION_QUEUE_PATH,
        VERIFICATION_DETAILS_PATH,
        VERIFICATION_REVIEW_PATH,
      ];

      const validPostPreflight =
        postPaths.includes(req.path) &&
        requestedMethod === "POST";

      const validDocumentPreflight =
        req.path === VERIFICATION_DOCUMENT_PATH &&
        requestedMethod === "GET";

      if (!validPostPreflight && !validDocumentPreflight) {
        return reject(
          res,
          403,
          "permission-denied",
          "Preflight not allowed."
        );
      }

      if (
        requestedHeaders.some(
          (header) =>
            !["authorization", "content-type"].includes(header)
        )
      ) {
        return reject(
          res,
          403,
          "permission-denied",
          "Preflight headers not allowed."
        );
      }

      res.set(
        "Access-Control-Allow-Methods",
        validPostPreflight ? "POST" : "GET"
      );

      res.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type"
      );

      return res.sendStatus(204);
    }

    next();
  });

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  app.get("/health", (req, res) => {
  return res.status(200).json({
    status: "ok",
    mode: "local",
    accountMutationsEnabled:
      demoPolicy?.accountMutationsEnabled === true,
    jobSoftDeleteEnabled:
      demoPolicy?.jobSoftDeleteEnabled === true,
  });
});

  // ---------------------------------------------------------------------------
  // Account management, job soft-delete and verification POST endpoints
  // ---------------------------------------------------------------------------

  app.post(
    [
      API_PATH,
      JOB_PATH,
      VERIFICATION_QUEUE_PATH,
      VERIFICATION_DETAILS_PATH,
      VERIFICATION_REVIEW_PATH,
    ],
    express.json({
      limit: "4kb",
      strict: true,
      type: "application/json",
    }),
    async (req, res) => {
      try {
        // POST endpoints must not receive query parameters.
        if (Object.keys(req.query).length !== 0) {
          return reject(
            res,
            400,
            "invalid-argument",
            "Query parameters are not allowed."
          );
        }

        if (!req.is("application/json")) {
  return reject(
    res,
    415,
    "invalid-argument",
    "Content-Type must be application/json."
  );
}

        const data = req.body;

        if (!isPlainObject(data)) {
          return reject(
            res,
            400,
            "invalid-argument",
            "A JSON object is required."
          );
        }

        // Verify Firebase ID token and revocation status.
        const token = getBearerToken(req);

        if (!token) {
          return reject(
            res,
            401,
            "unauthenticated",
            "A valid Bearer token is required."
          );
        }

        const actor = await auth.verifyIdToken(token, true);

        if (!actor || actor.admin !== true) {
          return reject(
            res,
            403,
            "permission-denied",
            "Administrator access is required."
          );
        }

        // Check the current Firebase account, not just the token claim.
        const currentUser = await auth.getUser(actor.uid);

        if (
          currentUser.disabled === true ||
          !currentUser.customClaims ||
          currentUser.customClaims.admin !== true
        ) {
          return reject(
            res,
            403,
            "permission-denied",
            "Administrator access is required."
          );
        }

        // ---------------------------------------------------------------------
        // Verification queue
        // ---------------------------------------------------------------------

        if (req.path === VERIFICATION_QUEUE_PATH) {
          const allowedKeys = [
            "accountType",
            "pageSize",
            "pageToken",
          ];

          if (!hasOnlyKeys(data, allowedKeys)) {
            return reject(
              res,
              400,
              "invalid-argument",
              "Invalid verification queue request."
            );
          }

          const result =
            await verificationManager.listPendingVerificationSubmissions({
              auth,
              db,
              actor,
              ...data,
            });

          return res.status(200).json({
            data: result,
          });
        }

        // ---------------------------------------------------------------------
        // Verification submission details and history
        // ---------------------------------------------------------------------

        if (req.path === VERIFICATION_DETAILS_PATH) {
          const allowedKeys = [
            "uid",
            "submissionId",
            "historyPageSize",
            "historyPageToken",
          ];

          if (
            !hasOnlyKeys(data, allowedKeys) ||
            !isValidUid(data.uid)
          ) {
            return reject(
              res,
              400,
              "invalid-argument",
              "Invalid verification details request."
            );
          }

          const result =
            await verificationManager.getVerificationSubmission({
              auth,
              db,
              actor,
              ...data,
            });

          return res.status(200).json({
            data: result,
          });
        }

        // ---------------------------------------------------------------------
        // Verification review: approve or reject
        // ---------------------------------------------------------------------

        if (req.path === VERIFICATION_REVIEW_PATH) {
          const allowedKeys = [
            "uid",
            "submissionId",
            "decision",
            "rejectionReason",
          ];

          if (
            !hasOnlyKeys(data, allowedKeys) ||
            !isValidUid(data.uid)
          ) {
            return reject(
              res,
              400,
              "invalid-argument",
              "Invalid verification review request."
            );
          }

          if (
            data.decision === "approved" &&
            !bucket
          ) {
            return reject(
              res,
              503,
              "unavailable",
              "Verification storage is not configured."
            );
          }

          const result = await serialized(() =>
            verificationManager.reviewVerificationSubmission({
              auth,
              db,
              bucket,
              actor,
              ...data,
            })
          );

          return res.status(200).json({
            data: result,
          });
        }

        // ---------------------------------------------------------------------
        // Job posting soft-delete
        // ---------------------------------------------------------------------

        if (req.path === JOB_PATH) {
          const result = await serialized(() =>
            manageJob({
              auth,
              db,
              actor,
              data,
              demoPolicy,
            })
          );

          return res.status(200).json({
            data: result,
          });
        }

        // ---------------------------------------------------------------------
        // Account management
        // ---------------------------------------------------------------------

        if (req.path === API_PATH) {
          const allowedKeys = [
            "uid",
            "kind",
            "action",
            "disabled",
            "expectedDisabled",
            "confirmUid",
          ];

          if (!hasOnlyKeys(data, allowedKeys)) {
            return reject(
              res,
              400,
              "invalid-argument",
              "Invalid account management request."
            );
          }

          if (
            !isValidUid(data.uid) ||
            !["locum", "practice_owner"].includes(data.kind) ||
            !["status", "setDisabled", "delete"].includes(data.action)
          ) {
            return reject(
              res,
              400,
              "invalid-argument",
              "Invalid account management request."
            );
          }

          if (
            data.disabled !== undefined &&
            typeof data.disabled !== "boolean"
          ) {
            return reject(
              res,
              400,
              "invalid-argument",
              "Invalid disabled value."
            );
          }

          if (
            data.expectedDisabled !== undefined &&
            typeof data.expectedDisabled !== "boolean"
          ) {
            return reject(
              res,
              400,
              "invalid-argument",
              "Invalid expectedDisabled value."
            );
          }

          if (
            data.confirmUid !== undefined &&
            typeof data.confirmUid !== "string"
          ) {
            return reject(
              res,
              400,
              "invalid-argument",
              "Invalid confirmation UID."
            );
          }

          if (
            data.action === "status" &&
            !hasOnlyKeys(data, ["uid", "kind", "action"])
          ) {
            return reject(
              res,
              400,
              "invalid-argument",
              "Status requests cannot contain mutation fields."
            );
          }

          // Physical account deletion is not permitted.
          if (data.action === "delete") {
            return reject(
              res,
              403,
              "permission-denied",
              "Account deletion is not allowed."
            );
          }

          // Account mutations remain disabled unless explicitly enabled
          // by the existing demo policy.
          if (
            data.action !== "status" &&
            (!demoPolicy ||
              demoPolicy.accountMutationsEnabled !== true)
          ) {
            return reject(
              res,
              403,
              "failed-precondition",
              "Account mutations are disabled."
            );
          }

          const result = await serialized(() =>
            manager({
              auth,
              db,
              actor,
              data,
              demoPolicy,
            })
          );

          return res.status(200).json({
            data: {
              ...result,
              mutationsEnabled:
                demoPolicy?.accountMutationsEnabled === true,
            },
          });
        }

        return reject(
          res,
          404,
          "not-found",
          "Route not found."
        );
      } catch (error) {
        // Verification-specific errors.
        if (
          error instanceof
          verification.VerificationManagementError
        ) {
          return reject(
            res,
            getErrorStatus(error.code),
            error.code,
            error.message
          );
        }

        // Existing account-management errors.
        if (error instanceof ManagementError) {
          return reject(
            res,
            getErrorStatus(error.code),
            error.code,
            error.message
          );
        }

        // Firebase token errors.
        if (
          [
            "auth/argument-error",
            "auth/invalid-id-token",
            "auth/id-token-expired",
            "auth/id-token-revoked",
            "auth/invalid-user-token",
            "auth/user-disabled",
          ].includes(error.code)
        ) {
          return reject(
            res,
            401,
            "unauthenticated",
            "Authentication failed."
          );
        }

        if (error.code === "auth/user-not-found") {
          return reject(
            res,
            404,
            "not-found",
            "Administrator account not found."
          );
        }

        // Firebase Admin SDK / IAM permission errors.
        if (
  [
    "auth/insufficient-permission",
    "permission-denied",
    7,
  ].includes(error.code)
) {
  return reject(
    res,
    403,
    "permission-denied",
    "The local server identity lacks required permissions."
  );
}

        if (error.code === "resource-exhausted") {
          return reject(
            res,
            429,
            "resource-exhausted",
            "The server is busy. Please try again."
          );
        }

        // Do not expose internal error details to the browser.
        return reject(
          res,
          503,
          "unavailable",
          "The request could not be completed."
        );
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Private verification document endpoint
  // ---------------------------------------------------------------------------

  app.get(VERIFICATION_DOCUMENT_PATH, (req, res) => {
    if (!documentHandler) {
      res.set("Cache-Control", "private, no-store");

      return reject(
        res,
        503,
        "unavailable",
        "Private verification storage is not configured."
      );
    }

    return documentHandler(req, res);
  });

  // ---------------------------------------------------------------------------
  // Not found
  // ---------------------------------------------------------------------------

  app.use((req, res) => {
    return reject(
      res,
      404,
      "not-found",
      "Route not found."
    );
  });

  // ---------------------------------------------------------------------------
  // Express error handler
  // ---------------------------------------------------------------------------

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    if (
      error.type === "entity.too.large"
    ) {
      return reject(
        res,
        413,
        "invalid-argument",
        "Request body is too large."
      );
    }

    if (
      error.type === "entity.parse.failed" ||
      error instanceof SyntaxError
    ) {
      return reject(
        res,
        400,
        "invalid-argument",
        "Invalid JSON request body."
      );
    }

    return reject(
      res,
      503,
      "unavailable",
      "The request could not be completed."
    );
  });

  return app;
}

module.exports = {
  createLocalApp,
  createSerialExecutor,
  HOST,
  PORT,
  ORIGIN,
  API_PATH,
};
