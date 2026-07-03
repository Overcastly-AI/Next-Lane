-- Migration: add_velocity_trend_gadget_visualization
-- Adds the VELOCITY_TREND value to the DashboardGadgetVisualization enum, for
-- Configurable dashboards — Phase 2's cross-sprint velocity trend gadget
-- (committed vs completed story points over the project's last N sprints,
-- evaluated project-wide rather than scoped by the gadget's NLQL query).
--
-- ADDITIVE ONLY — no existing enum values, columns, or rows are touched.
-- Postgres 12+ allows ALTER TYPE ... ADD VALUE inside a transaction as long as
-- the new value isn't used in the SAME transaction, which holds here (this
-- migration only adds the value; no INSERT/UPDATE references it).

ALTER TYPE "DashboardGadgetVisualization" ADD VALUE 'VELOCITY_TREND';
