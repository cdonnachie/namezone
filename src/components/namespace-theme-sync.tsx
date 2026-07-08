"use client";

import { useEffect } from "react";

/**
 * Mirrors the namespace key onto <body>. The [data-namespace="radiant"]
 * palette override in globals.css only paints elements at or under whatever
 * DOM node carries the attribute - but <Toaster/> is a sibling of this
 * layout's div (see app/layout.tsx), and Radix dialogs/dropdowns/tooltips/
 * selects portal straight to document.body, so none of them are descendants
 * of the namespace div. Setting the attribute on body itself covers all of
 * that sibling/portaled UI too.
 */
export function NamespaceThemeSync({ namespace }: { namespace: string }) {
  useEffect(() => {
    document.body.dataset.namespace = namespace;
    return () => {
      delete document.body.dataset.namespace;
    };
  }, [namespace]);

  return null;
}
