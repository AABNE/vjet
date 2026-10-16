import { db, flightsTable, pool, timetableTable, usersTable } from "@workspace/db";

async function resetJetstarData() {
  await db.delete(timetableTable);
  await db.delete(flightsTable);
  await db.delete(usersTable);
  await pool.query("DELETE FROM session");
  process.stdout.write("Cleared pilot accounts, flight records, and sessions.\n");
}

resetJetstarData()
  .catch((error) => {
    process.stderr.write(`Jetstar reset failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
