import { useState, type FormEvent } from 'react';
import { useAddComment, useComments } from '@/api/comments';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { useAuth } from '@/auth/AuthContext';

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
            <li key={c.id} className="flex gap-2">
              <Avatar user={c.author} size="md" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-gray-800">
                    {c.author.name}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-gray-700">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-gray-400">No comments yet.</p>
      )}
    </div>
  );
}
