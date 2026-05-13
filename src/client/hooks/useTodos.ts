import { useQuery } from '@tanstack/react-query';
import { todosApi } from '../lib/api.js';

export function useTodos() {
  return useQuery({
    queryKey: ['todos', 'list'],
    queryFn: () => todosApi.list(),
  });
}

export function useTodosCounts() {
  return useQuery({
    queryKey: ['todos', 'counts'],
    queryFn: () => todosApi.counts(),
  });
}
