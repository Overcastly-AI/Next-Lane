import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyWorkDto, UpdateProfileDto, UserDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';
import { updateProfile } from './auth';

/** The current user's work (assigned + reported) across all their workspaces. */
export function useMyWork() {
  return useQuery<MyWorkDto, Error>({
    queryKey: qk.myWork,
    queryFn: ({ signal }) => request<MyWorkDto>('/me/work', { signal }),
  });
}

/**
 * Update the current user's profile (name, email-notification preference).
 * On success the cached `me` query is primed with the fresh user so the header
 * avatar and any name display update immediately.
 */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation<UserDto, Error, UpdateProfileDto>({
    mutationFn: (input) => updateProfile(input),
    onSuccess: (user) => {
      qc.setQueryData(qk.me, user);
    },
  });
}
