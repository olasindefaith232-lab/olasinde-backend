import "dotenv/config";
import { getDatabase } from "../src/db.js";

const sql = getDatabase();

await sql`
	CREATE TABLE IF NOT EXISTS enquiries (
		id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		name VARCHAR(120) NOT NULL,
		email VARCHAR(254) NOT NULL,
		enquiry_type VARCHAR(20) NOT NULL CHECK (enquiry_type IN ('product', 'project', 'training', 'general')),
		product_slug VARCHAR(120),
		course_slug VARCHAR(120),
		message VARCHAR(5000) NOT NULL,
		status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'archived')),
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)
`;

await sql`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'new'`;
await sql`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
await sql`ALTER TABLE enquiries DROP CONSTRAINT IF EXISTS enquiries_status_check`;
await sql`ALTER TABLE enquiries ADD CONSTRAINT enquiries_status_check CHECK (status IN ('new', 'in_progress', 'resolved', 'archived'))`;

await sql`
	CREATE TABLE IF NOT EXISTS discussions (
		id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		title VARCHAR(100) NOT NULL,
		body VARCHAR(500) NOT NULL,
		hidden BOOLEAN NOT NULL DEFAULT FALSE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)
`;

await sql`ALTER TABLE discussions ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE`;

await sql`
	CREATE TABLE IF NOT EXISTS discussion_replies (
		id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		discussion_id BIGINT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
		body VARCHAR(1000) NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)
`;

const starterDiscussions = [
	["What should I know before my first PLC lesson?", "Which control-circuit concepts would you want to review before getting started?"],
	["Choosing cable for a home inverter setup", "What questions come up for you when learning about cable sizing and inverter installations?"],
	["Share your workshop practice tips", "What small habits have helped you work more safely and accurately?"],
];

for (const [title, body] of starterDiscussions) {
	await sql`
		INSERT INTO discussions (title, body)
		SELECT ${title}, ${body}
		WHERE NOT EXISTS (SELECT 1 FROM discussions WHERE title = ${title})
	`;
}

const [counts] = await sql`
	SELECT
		(SELECT COUNT(*)::int FROM enquiries) AS enquiries,
		(SELECT COUNT(*)::int FROM discussions) AS discussions,
		(SELECT COUNT(*)::int FROM discussion_replies) AS replies
`;
console.log(`Neon schema ready. Records: ${counts.enquiries} enquiries, ${counts.discussions} discussions, ${counts.replies} replies.`);
