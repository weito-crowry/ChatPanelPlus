import { useEffect, useState } from 'react';
import { createChromeProjectNamesRepository } from '../shared/project-names-repository.ts';
import { DEFAULT_PROJECT_PANEL_TITLE, ProjectTitleController } from './project-title-controller.ts';

export function ProjectPanelTitle() {
  const [title, setTitle] = useState(DEFAULT_PROJECT_PANEL_TITLE);

  useEffect(() => {
    const controller = new ProjectTitleController({
      document,
      window,
      repository: createChromeProjectNamesRepository(),
      onTitleChange: setTitle,
    });
    controller.start();
    return () => controller.dispose();
  }, []);

  return <>{title}</>;
}
