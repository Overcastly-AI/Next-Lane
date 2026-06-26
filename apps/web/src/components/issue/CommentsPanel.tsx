import { useState, type FormEvent } from 'react';
import {
  useAddComment,
  useComments,
  useDeleteComment,
  useUpdateComment,
} from '@/api/comments';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner, ErrorState } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { useAuth } from '@/auth/AuthContext';
import type { CommentDto } from '@next-lane/shared';

export function CommentsPanel({ issueId }: { issueId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const commentsQuery = useComments(issueId);
  const addComment = useAddComment(issueId);
  const [body, setBody] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    try {
      await addComment.mutateAsync(text);
      setBody('');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not post comment.'));
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-gray-600">Comments</p>

      <form onSubmit={onSubmit} className="flex gap-2">
        <Avatar user={user} size="md" className="mt-0.5" />
        <div className="flex-1 space-y-2">
          <Textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment…"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                void onSubmit(e as unknown as FormEvent);
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">⌘/Ctrl + Enter to send</span>
            <Button
              type="submit"
              size="sm"
              loading={addComment.isPending}
              disabled={!body.trim()}
            >
              Comment
            </Button>
          </div>
          {addComment.isError && (
            <p className="text-xs text-red-600">
              Couldn’t post comment. Try again.
            </p>
          )}
        </div>
      </form>

      {commentsQuery.isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : commentsQuery.isError ? (
        <ErrorState
          error={commentsQuery.error}
          onRetry={() => commentsQuery.refetch()}
        />
      ) : commentsQuery.data && commentsQuery.data.length > 0 ? (
        <ul className="space-y-3">
          {commentsQuery.data.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              issueId={issueId}
              isOwn={!!user && c.author.id === user.id}
            />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-gray-400">No comments yet.</p>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  issueId,
  isOwn,
}: {
  comment: CommentDto;
  issueId: string;
  isOwn: boolean;
}) {
  const toast = useToast();
  const updateComment = useUpdateComment(issueId);
  const deleteComment = useDeleteComment(issueId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function startEdit() {
    setDraft(comment.body);
    setEditing(true);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (text === comment.body) {
      setEditing(false);
      return;
    }
    try {
      await updateComment.mutateAsync({ id: comment.id, body: text });
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save comment.'));
    }
  }

  async function confirmRemove() {
    try {
      await deleteComment.mutateAsync(comment.id);
      setConfirmDelete(false);
    } catch (err) {
      setConfirmDelete(false);
      toast.error(errorMessage(err, 'Could not delete comment.'));
    }
  }

  return (
    <li className="group flex gap-2">
      <Avatar user={comment.author} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-800">
            {comment.author.name}
          </span>
          <span className="text-xs text-gray-400">
            {new Date(comment.createdAt).toLocaleString()}
          </span>
          {isOwn && !editing && (
            <span className="ml-auto flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                onClick={startEdit}
                className="text-xs font-medium text-gray-500 hover:text-brand-600"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-xs font-medium text-gray-500 hover:text-red-600"
              >
                Delete
              </button>
            </span>
          )}
        </div>

        {editing ? (
          <form onSubmit={saveEdit} className="mt-1 space-y-2">
            <Textarea
              rows={2}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  void saveEdit(e as unknown as FormEvent);
                }
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                loading={updateComment.isPending}
                disabled={!draft.trim()}
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-gray-700">
            {comment.body}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete comment"
        message="This comment will be permanently removed. This can’t be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteComment.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}
