import cors from "cors";
import express from "express";
import helmet from "helmet";
import { getDatabase } from "./db.js";
import { clearAdminCookie, createAdminCookie, readAdminSession, verifyAdminPassword } from "./admin-auth.js";

const enquiryStatuses = new Set(["new", "in_progress", "resolved", "archived"]);
const enquiryTypes = new Set(["product", "project", "training", "general"]);

function cleanText(value, maxLength) {
	return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function allowedOrigins() {
	return [
		process.env.CLIENT_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173",
		process.env.ADMIN_ORIGIN ?? "http://localhost:5174,http://127.0.0.1:5174",
	]
		.flatMap((origins) => origins.split(","))
		.map((origin) => origin.trim())
		.filter(Boolean);
}

function requireSameOrigin(request, response, next) {
	const origin = request.get("origin");
	if (origin && !allowedOrigins().includes(origin)) {
		return response.status(403).json({ error: "Request origin is not allowed." });
	}
	next();
}

function requireAdmin(request, response, next) {
	const session = readAdminSession(request.headers.cookie);
	if (!session) return response.status(401).json({ error: "Admin login is required." });
	request.admin = session;
	next();
}

export function createApp() {
	const app = express();
	app.disable("x-powered-by");
	app.use(helmet());
	app.use(cors({ origin: allowedOrigins(), credentials: true }));
	app.use(express.json({ limit: "32kb" }));

	app.get("/api/health", async (_request, response) => {
		try {
			await getDatabase()`SELECT 1`;
			response.json({ status: "ok", database: "connected" });
		} catch (error) {
			response.status(error.status ?? 503).json({
				status: "error",
				database: process.env.DATABASE_URL ? "unavailable" : "not_configured",
				message: error.status ? error.message : "Database connection failed.",
			});
		}
	});

	app.post("/api/enquiries", requireSameOrigin, async (request, response) => {
		const name = cleanText(request.body?.name, 120);
		const email = cleanText(request.body?.email, 254).toLowerCase();
		const type = cleanText(request.body?.type, 20);
		const message = cleanText(request.body?.message, 5000);
		const productSlug = cleanText(request.body?.productSlug, 120) || null;
		const courseSlug = cleanText(request.body?.courseSlug, 120) || null;

		if (!name || !email || !message || !enquiryTypes.has(type)) {
			return response.status(400).json({ error: "Name, valid email, enquiry type, and message are required." });
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return response.status(400).json({ error: "Enter a valid email address." });
		}

		const [enquiry] = await getDatabase()`
			INSERT INTO enquiries (name, email, enquiry_type, product_slug, course_slug, message)
			VALUES (${name}, ${email}, ${type}, ${productSlug}, ${courseSlug}, ${message})
			RETURNING id::text AS id, created_at AS "createdAt", status
		`;
		response.status(201).json({ enquiry });
	});

	app.post("/api/admin/login", requireSameOrigin, async (request, response) => {
		const email = cleanText(request.body?.email, 254).toLowerCase();
		const password = typeof request.body?.password === "string" ? request.body.password : "";
		const configuredEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

		if (!configuredEmail || !process.env.ADMIN_PASSWORD_HASH || !process.env.SESSION_SECRET) {
			return response.status(503).json({ error: "Admin login is not configured on the server." });
		}
		if (email !== configuredEmail || !verifyAdminPassword(password, process.env.ADMIN_PASSWORD_HASH)) {
			return response.status(401).json({ error: "Email or password is incorrect." });
		}

		response.setHeader("Set-Cookie", createAdminCookie(email));
		response.json({ admin: { email } });
	});

	app.get("/api/admin/session", (request, response) => {
		const session = readAdminSession(request.headers.cookie);
		if (!session) return response.status(401).json({ error: "Admin login is required." });
		response.json({ admin: { email: session.email } });
	});
	app.get("/api/admin/me", (request, response) => {
		const session = readAdminSession(request.headers.cookie);
		if (!session) return response.status(401).json({ error: "Admin login is required." });
		response.json({ admin: { email: session.email } });
	});

	app.post("/api/admin/logout", requireSameOrigin, (_request, response) => {
		response.setHeader("Set-Cookie", clearAdminCookie());
		response.status(204).end();
	});

	app.get("/api/admin/overview", requireAdmin, async (_request, response) => {
		const sql = getDatabase();
		const [counts, enquiries, discussions] = await Promise.all([
			sql`SELECT status, COUNT(*)::int AS count FROM enquiries GROUP BY status`,
			sql`
				SELECT id::text AS id, name, email, enquiry_type AS "type",
					product_slug AS "productSlug", course_slug AS "courseSlug",
					message, status, created_at AS "createdAt"
				FROM enquiries
				ORDER BY created_at DESC
				LIMIT 100
			`,
			sql`
				SELECT discussion.id::text AS id, discussion.title, discussion.body,
					discussion.hidden, COUNT(reply.id)::int AS "replyCount",
					discussion.created_at AS "createdAt"
				FROM discussions AS discussion
				LEFT JOIN discussion_replies AS reply ON reply.discussion_id = discussion.id
				GROUP BY discussion.id
				ORDER BY discussion.created_at DESC
				LIMIT 300
			`,
		]);
		const summary = { total: 0, new: 0, in_progress: 0, resolved: 0, archived: 0 };
		for (const row of counts) {
			summary[row.status] = row.count;
			summary.total += row.count;
		}
		response.json({ summary, enquiries, discussions });
	});

	app.patch("/api/admin/enquiries/:id", requireSameOrigin, requireAdmin, async (request, response) => {
		const id = cleanText(request.params.id, 32);
		const status = cleanText(request.body?.status, 20);
		if (!/^\d+$/.test(id) || !enquiryStatuses.has(status)) {
			return response.status(400).json({ error: "A valid enquiry id and status are required." });
		}

		const [enquiry] = await getDatabase()`
			UPDATE enquiries SET status = ${status}, updated_at = NOW()
			WHERE id = ${id}::bigint
			RETURNING id::text AS id, status
		`;
		if (!enquiry) return response.status(404).json({ error: "Enquiry not found." });
		response.json({ enquiry });
	});

	app.patch("/api/admin/discussions/:id", requireSameOrigin, requireAdmin, async (request, response) => {
		const id = cleanText(request.params.id, 32);
		if (!/^\d+$/.test(id) || typeof request.body?.hidden !== "boolean") {
			return response.status(400).json({ error: "A valid discussion id and visibility are required." });
		}

		const [discussion] = await getDatabase()`
			UPDATE discussions SET hidden = ${request.body.hidden}
			WHERE id = ${id}::bigint
			RETURNING id::text AS id, hidden
		`;
		if (!discussion) return response.status(404).json({ error: "Discussion not found." });
		response.json({ discussion });
	});

	app.get("/api/discussions", async (_request, response) => {
		const discussions = await getDatabase()`
			SELECT discussion.id::text AS id, discussion.title, discussion.body,
				COALESCE(json_agg(reply.body ORDER BY reply.created_at) FILTER (WHERE reply.id IS NOT NULL), '[]'::json) AS replies
			FROM discussions AS discussion
			LEFT JOIN discussion_replies AS reply ON reply.discussion_id = discussion.id
			WHERE discussion.hidden = FALSE
			GROUP BY discussion.id
			ORDER BY discussion.created_at DESC
			LIMIT 100
		`;
		response.json({ discussions });
	});

	app.post("/api/discussions", requireSameOrigin, async (request, response) => {
		const title = cleanText(request.body?.title, 100);
		const body = cleanText(request.body?.body, 500);
		if (!title || !body) return response.status(400).json({ error: "Discussion title and question are required." });
		const [discussion] = await getDatabase()`
			INSERT INTO discussions (title, body)
			VALUES (${title}, ${body})
			RETURNING id::text AS id, title, body, created_at AS "createdAt"
		`;
		response.status(201).json({ discussion: { ...discussion, replies: [] } });
	});

	app.post("/api/discussions/:discussionId/replies", requireSameOrigin, async (request, response) => {
		const id = cleanText(request.params.discussionId, 32);
		const body = cleanText(request.body?.body, 1000);
		if (!/^\d+$/.test(id) || !body) return response.status(400).json({ error: "A valid discussion and reply are required." });
		const [reply] = await getDatabase()`
			INSERT INTO discussion_replies (discussion_id, body)
			SELECT id, ${body} FROM discussions WHERE id = ${id}::bigint AND hidden = FALSE
			RETURNING id::text AS id, discussion_id::text AS "discussionId", body
		`;
		if (!reply) return response.status(404).json({ error: "Discussion not found." });
		response.status(201).json({ reply });
	});

	app.use("/api", (_request, response) => response.status(404).json({ error: "API endpoint not found." }));
	app.use((error, _request, response, _next) => {
		console.error(error);
		response.status(error.status ?? 500).json({ error: error.status ? error.message : "Unexpected server error." });
	});
	return app;
}
