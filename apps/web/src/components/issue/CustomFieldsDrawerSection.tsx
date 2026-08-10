/**
 * CustomFieldsDrawerSection
 *
 * Rendered inside the IssueDetailDrawer sidebar. Shows only the custom field
 * definitions whose `appliesToTypes` includes the current issue's type (or all
 * fields when `appliesToTypes` is empty). Editing a value fires a PATCH to the
 * issue endpoint (partial merge semantics — only the changed key is sent, null
 * to clear).
 */
import { useCustomFields } from '@/api/custom-fields';
import { useUpdateIssueCustomFields } from '@/api/custom-fields';
import type { CustomFieldValue } from '@/api/custom-fields';
import { CustomFieldInput } from './CustomFieldInput';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import type { IssueType } from '@next-lane/shared';

export function CustomFieldsDrawerSection({
  issueId,
  projectId,
  issueType,
  currentValues,
  editable,
}: {
  issueId: string;
  projectId: string;
  issueType: IssueType;
  currentValues: Record<string, CustomFieldValue> | undefined;
  editable: boolean;
}) {
  const fieldsQuery = useCustomFields(projectId);
  const updateValues = useUpdateIssueCustomFields();
  const toast = useToast();

  const allFields = fieldsQuery.data ?? [];

  // Filter: show fields where appliesToTypes is empty (= all) or contains this issue type.
  const applicableFields = allFields.filter(
    (f) =>
      f.appliesToTypes.length === 0 || f.appliesToTypes.includes(issueType),
  );

  if (!fieldsQuery.isLoading && applicableFields.length === 0) {
    return null;
  }

  if (fieldsQuery.isLoading) {
    return (
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
          Custom fields
        </p>
        <p className="text-xs text-slate-400">Loading…</p>
      </div>
    );
  }

  function handleChange(fieldId: string, value: CustomFieldValue) {
    updateValues.mutate(
      { issueId, projectId, values: { [fieldId]: value } },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not save field value.')),
      },
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
        Custom fields
      </p>
      {applicableFields.map((field) => (
        <CustomFieldInput
          key={field.id}
          definition={field}
          value={currentValues?.[field.id] ?? null}
          // Deliberately NOT disabled while a save is in flight: doing that
          // yanks the control out from under whoever is still editing it
          // (a disabled input loses focus), which is exactly how the date
          // fields became untypeable. Each save sends only its own key, so
          // overlapping edits merge safely.
          disabled={!editable}
          onChange={(val) => handleChange(field.id, val)}
        />
      ))}
    </div>
  );
}
