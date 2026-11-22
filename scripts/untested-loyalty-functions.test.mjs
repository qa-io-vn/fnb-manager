// node --test scripts/untested-loyalty-functions.test.mjs: the listing of loyalty
// SQL functions that no pgTAP file names (G-40). Synthetic migrations and tests;
// the last case runs the script on the repository and reads files only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	functionsAfterMigrations,
	LOYALTY_NAME,
	loyaltyNames,
	namedIn,
	untestedLoyaltyFunctions,
} from "./untested-loyalty-functions.mjs";

const SCRIPT = fileURLToPath(
	new URL("./untested-loyalty-functions.mjs", import.meta.url),
);

const migration = (file, text) => ({ file, text });

test("the latest definition of a name wins, whichever order the files are given in (state transition: create, then replace)", () => {
	const defined = functionsAfterMigrations([
		migration(
			"002_replace.sql",
			"create or replace function app.loyalty_join(a uuid) returns int as $$ select 2 $$ language sql;",
		),
		migration(
			"001_create.sql",
			"CREATE FUNCTION app.loyalty_join(a uuid) returns int as $$ select 1 $$ language sql;",
		),
	]);
	assert.deepEqual([...defined], [["app.loyalty_join", "002_replace.sql"]]);
});

test("only the app and public schemas count (equivalence partitioning of schemas)", () => {
	const defined = functionsAfterMigrations([
		migration(
			"001.sql",
			[
				"create function app.a_one() returns int as $$ select 1 $$ language sql;",
				"create function public.b_two() returns int as $$ select 1 $$ language sql;",
				"create function extensions.c_three() returns int as $$ select 1 $$ language sql;",
				"create function d_four() returns int as $$ select 1 $$ language sql;",
			].join("\n"),
		),
	]);
	assert.deepEqual([...defined.keys()].sort(), ["app.a_one", "public.b_two"]);
});

test("a dropped function leaves the list until a later create brings it back (state transition: drop, recreate)", () => {
	const dropped = functionsAfterMigrations([
		migration(
			"001.sql",
			"create function app.coupon_old(a int) returns int as $$ select 1 $$ language sql;",
		),
		migration("002.sql", "drop function if exists app.coupon_old(int);"),
	]);
	assert.equal(dropped.has("app.coupon_old"), false);
	const back = functionsAfterMigrations([
		migration(
			"001.sql",
			"create function app.coupon_old(a int) returns int as $$ select 1 $$ language sql;",
		),
		migration("002.sql", "drop function app.coupon_old(int);"),
		migration(
			"003.sql",
			"create function app.coupon_old(a int, b int) returns int as $$ select 1 $$ language sql;",
		),
	]);
	assert.equal(back.get("app.coupon_old"), "003.sql");
	const sameFile = functionsAfterMigrations([
		migration(
			"001.sql",
			"create function app.coupon_x(a int) returns int as $$ select 1 $$ language sql;\ndrop function app.coupon_x(int);\ncreate function app.coupon_x(a text) returns int as $$ select 1 $$ language sql;",
		),
	]);
	assert.equal(sameFile.has("app.coupon_x"), true);
});

test("a renamed function exists under its new name only, even with a nested argument type (error guessing)", () => {
	const defined = functionsAfterMigrations([
		migration(
			"001.sql",
			"create function app.loyalty_nightly(a uuid, b numeric(14, 2)) returns int as $$ select 1 $$ language sql;",
		),
		migration(
			"002.sql",
			"alter function app.loyalty_nightly(uuid, numeric(14, 2)) rename to loyalty_nightly_steps;",
		),
	]);
	assert.deepEqual([...defined.keys()], ["app.loyalty_nightly_steps"]);
});

test("a definition inside a comment is not a definition (negative case)", () => {
	const defined = functionsAfterMigrations([
		migration(
			"001.sql",
			[
				"-- create function app.commented_out() returns int",
				"/* create function app.block_commented() returns int */",
				"create function app.really_there() returns int as $$ select 1 $$ language sql;",
			].join("\n"),
		),
	]);
	assert.deepEqual([...defined.keys()], ["app.really_there"]);
});

test("a name is read as loyalty by its words (equivalence partitioning of names)", () => {
	for (const name of [
		"loyalty_join",
		"redemption_new_code",
		"staff_submit_bill",
		"customer_programme",
		"coupon_unmapped_stores",
		"reconcile_rails",
		"oa_form_enrol",
		"blank_erased_invoice_phone",
		"enqueue_points_confirmation",
		"member_share_by_shift",
		"code_attempt_gate",
		"phone_hash",
		"customers",
	]) {
		assert.equal(LOYALTY_NAME.test(name), true, name);
	}
	for (const name of [
		"set_updated_at",
		"refresh_analytics",
		"audit_trail",
		"derailed",
		"customerless",
		"membershipless",
		"hour_profile",
		"enqueue_message",
	]) {
		assert.equal(LOYALTY_NAME.test(name), false, name);
	}
});

test("loyaltyNames judges the bare name and honours a replacement pattern", () => {
	const names = ["app.loyalty_join", "app.set_updated_at", "public.my_wallet"];
	assert.deepEqual(loyaltyNames(names), [
		"app.loyalty_join",
		"public.my_wallet",
	]);
	assert.deepEqual(loyaltyNames(names, /updated/), ["app.set_updated_at"]);
	assert.deepEqual(loyaltyNames(names, /./), names);
});

test("a test file names a function by whole word, qualified or not, in any case (boundary value analysis of the match)", () => {
	assert.equal(
		namedIn(["select app.loyalty_join(1);"], "app.loyalty_join"),
		true,
	);
	assert.equal(namedIn(["select loyalty_join(1);"], "app.loyalty_join"), true);
	assert.equal(
		namedIn(["SELECT APP.LOYALTY_JOIN(1);"], "app.loyalty_join"),
		true,
	);
	assert.equal(
		namedIn(["has_function('app', 'loyalty_join')"], "app.loyalty_join"),
		true,
	);
	assert.equal(namedIn(["loyalty_join"], "app.loyalty_join"), true);
	// a longer or shorter name that only contains it is another name
	assert.equal(
		namedIn(["select app.loyalty_join_all(1);"], "app.loyalty_join"),
		false,
	);
	assert.equal(
		namedIn(["select app.pre_loyalty_join(1);"], "app.loyalty_join"),
		false,
	);
	assert.equal(
		namedIn(["select app.loyalty_join2(1);"], "app.loyalty_join"),
		false,
	);
	assert.equal(namedIn([], "app.loyalty_join"), false);
});

test("the list holds the untested loyalty names, sorted, with the counts (decision table: loyalty x named)", () => {
	const migrations = [
		migration(
			"001.sql",
			[
				"create function app.loyalty_tested() returns int as $$ select 1 $$ language sql;",
				"create function app.loyalty_untested() returns int as $$ select 1 $$ language sql;",
				"create function public.coupon_untested() returns int as $$ select 1 $$ language sql;",
				"create function app.plain_untested() returns int as $$ select 1 $$ language sql;",
				"create function app.plain_tested() returns int as $$ select 1 $$ language sql;",
			].join("\n"),
		),
	];
	const tests = [
		"select app.loyalty_tested();\nselect plain_tested();",
		"-- loyalty_untested is only mentioned in a comment\nselect 1;",
	];
	const result = untestedLoyaltyFunctions(migrations, tests);
	assert.deepEqual(result, {
		loyalty: 3,
		untested: ["app.loyalty_untested", "public.coupon_untested"],
	});
	assert.deepEqual(result.untested, [...result.untested].sort());
});

test("on the repository it prints names only, exits 0 and reads files without writing any (system test)", () => {
	const run = spawnSync(process.execPath, [SCRIPT], {
		encoding: "utf8",
		timeout: 60_000,
	});
	assert.equal(run.status, 0);
	const lines = run.stdout.split("\n").filter((line) => line !== "");
	assert.ok(lines.length > 0, "the repository has untested loyalty functions");
	for (const line of lines) {
		assert.match(line, /^(app|public)\.[a-z0-9_]+$/);
	}
	assert.match(run.stderr, /loyalty functions of app and public are not named/);
});

test("a --pattern without a value is refused (negative case)", () => {
	const run = spawnSync(process.execPath, [SCRIPT, "--pattern"], {
		encoding: "utf8",
		timeout: 60_000,
	});
	assert.equal(run.status, 2);
	assert.equal(run.stdout, "");
});
