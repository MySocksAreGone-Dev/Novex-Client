import './ProjectPage.css';
import { lazy, Suspense, type ComponentProps } from 'react';
const ProjectPage=lazy(()=>import('./ProjectPage'));
export default function ProjectPageView(props:ComponentProps<typeof ProjectPage>){return <Suspense fallback={<p role="status">Loading project view…</p>}><ProjectPage {...props}/></Suspense>;}
