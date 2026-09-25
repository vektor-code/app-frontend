import React from 'react';

/** Lazy import with one automatic retry — covers transient 404s during rolling deploys. */
export function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      return await factory();
    } catch (first) {
      // Brief pause so CDN / ingress can finish promoting the new assets.
      await new Promise(resolve => setTimeout(resolve, 400));
      try {
        return await factory();
      } catch {
        throw first;
      }
    }
  });
}
