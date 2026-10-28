'use client';

import { useEffect, useState } from 'react';
import { cmsCollections, getDocById, getPublishedCollection } from '@/lib/cms';

type CmsRecord = Record<string, unknown>;

/** CMS navigation labels and site settings for the shared Header/Footer; a failed read keeps their defaults. */
export function useSiteChrome() {
  const [navItems, setNavItems] = useState<CmsRecord[]>([]);
  const [settings, setSettings] = useState<CmsRecord | null>(null);

  useEffect(() => {
    let active = true;
    getPublishedCollection<CmsRecord>(cmsCollections.navigation)
      .then((rows) => { if (active) setNavItems(rows); })
      .catch((error) => console.error('Navigation could not be loaded.', error));
    getDocById<CmsRecord>(cmsCollections.siteSettings, 'site')
      .then((site) => { if (active) setSettings(site); })
      .catch((error) => console.error('Site settings could not be loaded.', error));
    return () => { active = false; };
  }, []);

  return { navItems, settings };
}
