import { LegalDocumentScreen } from '@/components/legal/legal-document-screen';
import { communitySections, legalDraftNotice } from '@/legal/additional-content';

export default function CommunityRulesScreen() {
  return <LegalDocumentScreen notice={legalDraftNotice} sections={communitySections} title="Community-Regeln" />;
}
