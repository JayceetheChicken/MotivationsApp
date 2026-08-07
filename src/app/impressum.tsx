import { LegalDocumentScreen } from '@/components/legal/legal-document-screen';
import { imprintSections, legalDraftNotice } from '@/legal/additional-content';

export default function ImprintScreen() {
  return <LegalDocumentScreen notice={legalDraftNotice} sections={imprintSections} title="Impressum" />;
}
