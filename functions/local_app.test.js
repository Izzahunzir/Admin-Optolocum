
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  createLocalApp,
  createSerialExecutor,
  ORIGIN,
  API_PATH,
} = require("./local_app");

const VERIFICATION_QUEUE_PATH = "/api/verification/queue";
const VERIFICATION_DETAILS_PATH = "/api/verification/details";
const VERIFICATION_REVIEW_PATH = "/api/verification/review";
const VERIFICATION_DOCUMENT_PATH = "/api/verification/document";

async function fixture(t, options = {}) {
  const checks = [];
  const verificationCalls = [];
  let dispatches = 0;
  let documentRequests = 0;

  const auth = {
    verifyIdToken: async (token, revoked) => {
      checks.push({ token, revoked });

      if (options.tokenError) {
        throw { code: options.tokenError };
      }

      return {
        uid: "admin",
        admin: options.tokenAdmin !== false,
      };
    },

    getUser: async (uid) => ({
      uid,
      disabled: options.disabled === true,
      customClaims: {
        admin: options.currentAdmin !== false,
      },
    }),
  };

  const verificationManager = {
    listPendingVerificationSubmissions: async (args) => {
      verificationCalls.push({
        method: "queue",
        args,
      });

      return {
        submissions: [],
        nextPageToken: null,
      };
    },

    getVerificationSubmission: async (args) => {
      verificationCalls.push({
        method: "details",
        args,
      });

      return {
        uid: args.uid,
        submissionId: args.submissionId,
        status: "submitted",
        history: [],
      };
    },

    reviewVerificationSubmission: async (args) => {
      verificationCalls.push({
        method: "review",
        args,
      });

      return {
        success: true,
        decision: args.decision,
      };
    },

    createVerificationDocumentHandler: (args) => {
      verificationCalls.push({
        method: "createDocumentHandler",
        args,
      });

      return async (req, res) => {
        documentRequests++;

        return res.status(200).json({
          data: {
            document: "mock-private-document",
          },
        });
      };
    },

    ...options.verificationManager,
  };

  const app = createLocalApp({
    auth,
    db: {},
    bucket: options.bucket === undefined ? {} : options.bucket,
    demoPolicy: options.demoPolicy || null,

    manager: async ({ data }) => {
      dispatches++;

      assert.equal(data.action, "status");

      if (options.failure) {
        throw new Error("PRIVATE CREDENTIAL CONTENT");
      }

      if (options.failureCode) {
        throw {
          code: options.failureCode,
          message: "PRIVATE IAM DETAILS",
        };
      }

      return {
        disabled: true,
      };
    },

    verificationManager,
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  t.after(() => new Promise((resolve) => server.close(resolve)));

  function request({
    method = "POST",
    path = API_PATH,
    host = "127.0.0.1:8787",
    origin = ORIGIN,
    token = "valid-token",
    body = {
      uid: "target",
      kind: "locum",
      action: "status",
    },
    headers = {},
  } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path,
          method,
          headers: {
            Host: host,
            ...(origin === null ? {} : { Origin: origin }),
            ...(token === null
              ? {}
              : { Authorization: `Bearer ${token}` }),
            "Content-Type": "application/json",
            ...headers,
          },
        },
        (res) => {
          let text = "";

          res.on("data", (chunk) => {
            text += chunk;
          });

          res.on("end", () => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text,
              json: text ? JSON.parse(text) : null,
            });
          });
        }
      );

      req.on("error", reject);

      req.end(
        method === "OPTIONS" || method === "GET"
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body)
      );
    });
  }

  return {
    request,
    checks,
    verificationCalls,
    documentRequests: () => documentRequests,
    dispatches: () => dispatches,
  };
}

// -----------------------------------------------------------------------------
// Existing regression tests
// -----------------------------------------------------------------------------

test("health reports default-disabled account and job permissions", async (t) => {
  const f = await fixture(t);

  const r = await f.request({
    method: "GET",
    path: "/health",
    origin: null,
    token: null,
  });

  assert.equal(r.status, 200);

  assert.deepEqual(r.json, {
    status: "ok",
    mode: "local",
    accountMutationsEnabled: false,
    jobSoftDeleteEnabled: false,
  });

  assert.equal(f.checks.length, 0);
  assert.equal(r.headers["cache-control"], "no-store");
});

test("health reports enabled account and job permissions", async (t) => {
  const f = await fixture(t, {
    demoPolicy: {
      accountMutationsEnabled: true,
      jobSoftDeleteEnabled: true,
    },
  });

  const r = await f.request({
    method: "GET",
    path: "/health",
    origin: null,
    token: null,
  });

  assert.equal(r.status, 200);

  assert.deepEqual(r.json, {
    status: "ok",
    mode: "local",
    accountMutationsEnabled: true,
    jobSoftDeleteEnabled: true,
  });

  assert.equal(f.checks.length, 0);
});

test("status checks revocation and current admin and never grants mutation capability", async (t) => {
  const f = await fixture(t);
  const r = await f.request();

  assert.equal(r.status, 200);

  assert.deepEqual(f.checks, [
    {
      token: "valid-token",
      revoked: true,
    },
  ]);

  assert.deepEqual(r.json, {
    data: {
      disabled: true,
      mutationsEnabled: false,
    },
  });

  assert.equal(r.headers["access-control-allow-origin"], ORIGIN);
  assert.equal(f.dispatches(), 1);
});

test("missing and revoked tokens are rejected", async (t) => {
  const f = await fixture(t);

  assert.equal(
    (await f.request({ token: null })).status,
    401
  );

  const revoked = await fixture(t, {
    tokenError: "auth/id-token-revoked",
  });

  assert.equal((await revoked.request()).status, 401);
  assert.equal(revoked.dispatches(), 0);
});

test("token claim, current claim and current enabled state are all required", async (t) => {
  for (const option of [
    { tokenAdmin: false },
    { currentAdmin: false },
    { disabled: true },
  ]) {
    const f = await fixture(t, option);

    assert.equal((await f.request()).status, 403);
    assert.equal(f.dispatches(), 0);
  }
});

test("strict Host and Origin restrictions reject external, null and missing origins", async (t) => {
  const f = await fixture(t);

  for (const origin of [
    "https://evil.example",
    "null",
    null,
    "http://localhost:9999",
  ]) {
    assert.equal(
      (await f.request({ origin })).status,
      403
    );
  }

  assert.equal(
    (await f.request({ host: "evil.example:8787" })).status,
    403
  );

  assert.equal(
    (await f.request({ host: "localhost:8787" })).status,
    403
  );

  assert.equal(f.checks.length, 0);
});

test("approved preflight has exact headers and cannot invoke Firebase", async (t) => {
  const f = await fixture(t);

  const r = await f.request({
    method: "OPTIONS",
    token: null,
    headers: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  });

  assert.equal(r.status, 204);
  assert.equal(r.headers["access-control-allow-origin"], ORIGIN);
  assert.equal(f.checks.length, 0);

  assert.equal(
    (
      await f.request({
        method: "OPTIONS",
        headers: {
          "Access-Control-Request-Method": "DELETE",
        },
      })
    ).status,
    403
  );
});

test("all mutations are blocked after authentication and before business dispatch", async (t) => {
  const f = await fixture(t);

  for (const body of [
    {
      uid: "target",
      kind: "locum",
      action: "setDisabled",
      disabled: true,
      expectedDisabled: false,
    },
    {
      uid: "target",
      kind: "practice_owner",
      action: "setDisabled",
      disabled: false,
      expectedDisabled: true,
    },
    {
      uid: "target",
      kind: "locum",
      action: "delete",
      confirmUid: "target",
    },
  ]) {
    const r = await f.request({ body });

    assert.equal(r.status, 403);

    assert.equal(
      r.json.error.code,
      body.action === "delete"
        ? "permission-denied"
        : "failed-precondition"
    );
  }

  assert.equal(f.checks.length, 3);
  assert.equal(f.dispatches(), 0);
});

test("validation rejects unexpected keys, malformed JSON, large bodies and non-JSON", async (t) => {
  const f = await fixture(t);

  assert.equal(
    (
      await f.request({
        body: {
          uid: "target",
          kind: "locum",
          action: "status",
          admin: true,
        },
      })
    ).status,
    400
  );

  assert.equal(
    (
      await f.request({
        body: {
          uid: "../target",
          kind: "locum",
          action: "status",
        },
      })
    ).status,
    400
  );

  assert.equal(
    (await f.request({ body: "{invalid" })).status,
    400
  );

  assert.equal(
    (
      await f.request({
        body: JSON.stringify({
          oversized: "x".repeat(5000),
        }),
      })
    ).status,
    413
  );

  assert.equal(
    (
      await f.request({
        headers: {
          "Content-Type": "text/plain",
        },
      })
    ).status,
    415
  );

  assert.equal(f.dispatches(), 0);
});

test("unexpected failures expose no internal exception details", async (t) => {
  const f = await fixture(t, {
    failure: true,
  });

  const r = await f.request();

  assert.equal(r.status, 503);
  assert.equal(
    r.text.includes("PRIVATE CREDENTIAL CONTENT"),
    false
  );
});

test("Firebase IAM permission failures are clear without leaking credential details", async (t) => {
  for (const failureCode of [
    "auth/insufficient-permission",
    7,
  ]) {
    const f = await fixture(t, {
      failureCode,
    });

    const r = await f.request();

    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, "permission-denied");

    assert.match(
      r.json.error.message,
      /local server identity lacks required/
    );

    assert.equal(r.text.includes("PRIVATE"), false);
  }
});

test("serialization prevents overlap and recovers after a rejected operation", async () => {
  const run = createSerialExecutor();
  const order = [];

  let release;

  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const first = run(async () => {
    order.push("first");
    await gate;
    throw new Error("test");
  });

  const assertion = assert.rejects(first, /test/);

  const second = run(async () => {
    order.push("second");
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(order, ["first"]);

  release();

  await assertion;
  await second;

  assert.deepEqual(order, ["first", "second"]);
});

// -----------------------------------------------------------------------------
// New Verification HTTP endpoint tests
// -----------------------------------------------------------------------------

test("verification queue requires authentication and returns queue data", async (t) => {
  const f = await fixture(t);

  const r = await f.request({
    path: VERIFICATION_QUEUE_PATH,
    body: {
      accountType: "locum",
      pageSize: 10,
    },
  });

  assert.equal(r.status, 200);

  assert.deepEqual(r.json, {
    data: {
      submissions: [],
      nextPageToken: null,
    },
  });

  assert.equal(f.checks.length, 1);
  assert.equal(f.checks[0].revoked, true);

  const call = f.verificationCalls.find(
    (entry) => entry.method === "queue"
  );

  assert.ok(call);
  assert.equal(call.args.accountType, "locum");
  assert.equal(call.args.pageSize, 10);
  assert.equal(call.args.actor.uid, "admin");
});

test("verification queue rejects unauthenticated and non-admin requests", async (t) => {
  const missing = await fixture(t);

  assert.equal(
    (
      await missing.request({
        path: VERIFICATION_QUEUE_PATH,
        token: null,
        body: {
          accountType: "locum",
        },
      })
    ).status,
    401
  );

  const nonAdmin = await fixture(t, {
    tokenAdmin: false,
  });

  assert.equal(
    (
      await nonAdmin.request({
        path: VERIFICATION_QUEUE_PATH,
        body: {
          accountType: "locum",
        },
      })
    ).status,
    403
  );

  assert.equal(
    nonAdmin.verificationCalls.length,
    1
  );

  assert.equal(
    nonAdmin.verificationCalls.some(
      (entry) => entry.method === "queue"
    ),
    false
  );
});

test("verification queue rejects unexpected request fields", async (t) => {
  const f = await fixture(t);

  const r = await f.request({
    path: VERIFICATION_QUEUE_PATH,
    body: {
      accountType: "locum",
      admin: true,
    },
  });

  assert.equal(r.status, 400);

  assert.equal(
    f.verificationCalls.some(
      (entry) => entry.method === "queue"
    ),
    false
  );
});

test("verification details endpoint passes submission identifiers to manager", async (t) => {
  const f = await fixture(t);

  const r = await f.request({
    path: VERIFICATION_DETAILS_PATH,
    body: {
      uid: "locum-user-123",
      submissionId: "a".repeat(40),
      historyPageSize: 10,
    },
  });

  assert.equal(r.status, 200);

  assert.equal(
    r.json.data.uid,
    "locum-user-123"
  );

  assert.equal(
    r.json.data.submissionId,
    "a".repeat(40)
  );

  const call = f.verificationCalls.find(
    (entry) => entry.method === "details"
  );

  assert.ok(call);
  assert.equal(call.args.uid, "locum-user-123");
  assert.equal(call.args.historyPageSize, 10);
});

test("verification details rejects invalid UID and unexpected fields", async (t) => {
  const f = await fixture(t);

  const invalidUid = await f.request({
    path: VERIFICATION_DETAILS_PATH,
    body: {
      uid: "../invalid",
      submissionId: "a".repeat(40),
    },
  });

  assert.equal(invalidUid.status, 400);

  const unexpected = await f.request({
    path: VERIFICATION_DETAILS_PATH,
    body: {
      uid: "valid-user",
      submissionId: "a".repeat(40),
      admin: true,
    },
  });

  assert.equal(unexpected.status, 400);

  assert.equal(
    f.verificationCalls.some(
      (entry) => entry.method === "details"
    ),
    false
  );
});

test("verification approval passes configured Storage bucket to manager", async (t) => {
  const f = await fixture(t);

  const r = await f.request({
    path: VERIFICATION_REVIEW_PATH,
    body: {
      uid: "locum-user-123",
      submissionId: "a".repeat(40),
      decision: "approved",
    },
  });

  assert.equal(r.status, 200);
  assert.equal(r.json.data.success, true);
  assert.equal(r.json.data.decision, "approved");

  const call = f.verificationCalls.find(
    (entry) => entry.method === "review"
  );

  assert.ok(call);
  assert.equal(call.args.decision, "approved");
  assert.ok(call.args.bucket);
  assert.equal(call.args.actor.uid, "admin");
});

test("verification rejection does not require Storage bucket", async (t) => {
  const f = await fixture(t, {
    bucket: null,
  });

  const r = await f.request({
    path: VERIFICATION_REVIEW_PATH,
    body: {
      uid: "practice-owner-123",
      submissionId: "b".repeat(40),
      decision: "rejected",
      rejectionReason: "The submitted document is unclear.",
    },
  });

  assert.equal(r.status, 200);
  assert.equal(r.json.data.decision, "rejected");

  const call = f.verificationCalls.find(
    (entry) => entry.method === "review"
  );

  assert.ok(call);
  assert.equal(call.args.decision, "rejected");
  assert.equal(call.args.bucket, null);
});

test("verification approval fails safely when Storage is not configured", async (t) => {
  const f = await fixture(t, {
    bucket: null,
  });

  const r = await f.request({
    path: VERIFICATION_REVIEW_PATH,
    body: {
      uid: "locum-user-123",
      submissionId: "a".repeat(40),
      decision: "approved",
    },
  });

  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, "unavailable");

  assert.equal(
    f.verificationCalls.some(
      (entry) => entry.method === "review"
    ),
    false
  );
});

test("verification review rejects unexpected fields and invalid UID", async (t) => {
  const f = await fixture(t);

  const invalidUid = await f.request({
    path: VERIFICATION_REVIEW_PATH,
    body: {
      uid: "../invalid",
      submissionId: "a".repeat(40),
      decision: "approved",
    },
  });

  assert.equal(invalidUid.status, 400);

  const unexpected = await f.request({
    path: VERIFICATION_REVIEW_PATH,
    body: {
      uid: "valid-user",
      submissionId: "a".repeat(40),
      decision: "approved",
      admin: true,
    },
  });

  assert.equal(unexpected.status, 400);

  assert.equal(
    f.verificationCalls.some(
      (entry) => entry.method === "review"
    ),
    false
  );
});

test("private verification document endpoint delegates to document handler", async (t) => {
  const f = await fixture(t);

  const r = await f.request({
    method: "GET",
    path:
      VERIFICATION_DOCUMENT_PATH +
      "?uid=locum-user-123&submissionId=" +
      "a".repeat(40),
  });

  assert.equal(r.status, 200);

  assert.deepEqual(r.json, {
    data: {
      document: "mock-private-document",
    },
  });

  assert.equal(f.documentRequests(), 1);

  assert.ok(
    f.verificationCalls.some(
      (entry) =>
        entry.method === "createDocumentHandler"
    )
  );
});

test("private document endpoint rejects unapproved origins before serving", async (t) => {
  const f = await fixture(t);

  const r = await f.request({
    method: "GET",
    path: VERIFICATION_DOCUMENT_PATH,
    origin: "https://evil.example",
  });

  assert.equal(r.status, 403);
  assert.equal(f.documentRequests(), 0);
});

test("private document preflight permits only GET", async (t) => {
  const f = await fixture(t);

  const allowed = await f.request({
    method: "OPTIONS",
    path: VERIFICATION_DOCUMENT_PATH,
    token: null,
    headers: {
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });

  assert.equal(allowed.status, 204);
  assert.equal(
    allowed.headers["access-control-allow-methods"],
    "GET"
  );

  const denied = await f.request({
    method: "OPTIONS",
    path: VERIFICATION_DOCUMENT_PATH,
    token: null,
    headers: {
      "Access-Control-Request-Method": "POST",
    },
  });

  assert.equal(denied.status, 403);
  assert.equal(f.documentRequests(), 0);
});
