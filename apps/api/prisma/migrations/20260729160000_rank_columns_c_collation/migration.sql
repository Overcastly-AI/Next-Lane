-- Fractional-index `rank` columns must sort by BYTE order, not by the
-- database's linguistic collation.
--
-- Every ordered list in Next Lane (board cards, backlog, personal-board cards,
-- the page tree) stores its position as a `fractional-indexing` key: a short
-- string over the alphabet [0-9A-Za-z] that is generated so that
-- `rankBetween(a, b)` sorts strictly between `a` and `b` *under ASCII
-- comparison*. Moving an item to the top of a list generates keys that walk
-- DOWN from "a0" into the uppercase range — "Zz", "Zy", "Zx", … — precisely
-- because uppercase sorts before lowercase in ASCII.
--
-- Under a linguistic collation (en_US.utf8 and friends — the default for the
-- Debian `postgres` images and for most managed Postgres providers) that is
-- not true: case is a tertiary weight, so 'a0' < 'Zy' < 'Zz'. `ORDER BY rank`
-- then returns an order the algorithm never intended, and an item dragged to
-- the TOP of a list silently reappears at the BOTTOM on the next read. It is
-- data that is stored correctly and read back in the wrong order, so nothing
-- errors and nothing looks wrong until a reload.
--
-- Observed: the e2e page-reorder spec reorders three pages to
-- [Beta, Gamma, Alpha] (ranks Zy, Zz, a0). On a C-collation database the tree
-- reads back in exactly that order; on the en_US.utf8 database our CI runs, it
-- reads back [Alpha, Beta, Gamma] — the untouched seed order.
--
-- Pinning the COLLATE on these columns makes the ordering correct on ANY
-- database, whatever its default collation, and rebuilds the rank indexes
-- with the right sort order as part of the same statement.
ALTER TABLE "Issue" ALTER COLUMN "rank" TYPE text COLLATE "C";
ALTER TABLE "PersonalCard" ALTER COLUMN "rank" TYPE text COLLATE "C";
ALTER TABLE "Page" ALTER COLUMN "rank" TYPE text COLLATE "C";
