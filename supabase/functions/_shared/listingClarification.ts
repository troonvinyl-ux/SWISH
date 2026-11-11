// Portable publication guidance. No AI percentage is an eBay requirement.
export type ListingHelpTarget = 'title' | 'description' | 'pricing' | 'category' | 'condition' | 'specifics' | 'photos' | 'policies' | 'connection' | 'inspection' | 'identification' | 'status' | 'account' | 'retry' | 'safety';
export interface ListingClarification { target: ListingHelpTarget; question: string; actionLabel: string; detail: string; fields: string[] }
export interface ListingErrorContext { error?: unknown; code?: unknown; missingRequiredAspects?: unknown; accepted?: unknown; publicationUnconfirmed?: unknown }
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim().slice(0, 100)).filter(Boolean))].slice(0, 25) : [];
export function listingClarification(input: ListingErrorContext): ListingClarification {
 const detail = typeof input.error === 'string' ? input.error.trim().slice(0, 1500) : 'The listing request did not return a usable result.';
 const text = detail.toLowerCase(), code = String(input.code ?? '');
 const help = (target: ListingHelpTarget, question: string, actionLabel: string, fields: string[] = []): ListingClarification => ({ target, question, actionLabel, detail, fields });
 if (input.accepted === true || input.publicationUnconfirmed === true || /PUBLISH_RECONCILIATION_REQUIRED|PUBLISH_RECONCILIATION/.test(code) || /unconfirmed outcome|outcome.*not.*confirmed|already.*submitt|publication needs checking/.test(text)) return help('status', 'Has eBay already created this listing? Check the existing submission before sending another.', 'Check existing submission');
 if (/CONFIDENCE|IDENTIFICATION_REVIEW/.test(code) || /confidence.*(before|too low)|observation-only/.test(text)) return help('identification', 'AI confidence is advisory. Review the factual title and disclose any uncertain attribution; a higher AI score is not required.', 'Review title and description');
 if (/MANIFEST_REVIEW/.test(code) || /manifest.*(inspection|reviewed|inspection)/.test(text)) return help('inspection', 'Have you physically inspected this manifest item and confirmed its contents and sellable quantity?', 'Confirm stock inspection');
 if (/usage limit|error 518|selling restriction|selling limit|suspended|restricted account/.test(text)) return help('account', 'Can your eBay account/application accept another listing? Check the limit or restriction identified below; editing item evidence will not resolve it.', 'Open eBay account');
 if (/auth|reconnect|re-author|token|consent|connector/.test(text) && !/taxonomy|condition metadata/.test(text)) return help('connection', 'Is this business connected to your eBay selling account with publish permission?', 'Open eBay connection');
 if (/fulfillment|shipping policy|return policy|business polic|seller polic/.test(text)) return help('policies', 'Which shipping and return policies should this eBay listing use? Select the missing policy in eBay settings.', 'Select eBay policies');
 if (/unavailable|could not (run|read|load|verify)|timed out|timeout|failed to fetch|network|metadata http|lookup failed|taxonomy api error|request failed|no server response/.test(text)) return help('retry', 'The service check did not finish. No extra item facts are requested; retry the requirements check or use the saved draft after service recovery.', 'Retry requirements check');
 const fields = strings(input.missingRequiredAspects);
 const required = detail.match(/Complete required item specific:\s*(.+?)\.?$/i)?.[1];
 const selection = detail.match(/Choose an eBay-supported value for\s+(.+?)\.?$/i)?.[1];
 const missing = detail.match(/requires additional item (?:information|specifics):\s*([^.!]+)/i)?.[1];
 const requested = fields.length ? fields : required ? [required] : selection ? [selection] : missing ? strings(missing.split(',')) : [];
 if (requested.length || /item specific|specific name|specifics|aspect|supported value length/.test(text)) return help('specifics', requested.length ? `What is the correct ${requested.join(', ')} for this item? Enter the factual value or choose an offered eBay value.` : 'Which item-specific value needs correction? Use the exact field and constraint reported below.', 'Complete requested fields', requested);
 if (/photo|photograph|image/.test(text)) return help('photos', 'Which saved item photos should buyers see? Select 1–12 verified photos; retry any upload or processing failure reported below.', 'Review selected photos');
 if (/category|leaf/.test(text)) return help('category', 'Which final eBay category describes this item? Choose a leaf category, not a parent heading.', 'Choose eBay category');
 if (/condition/.test(text)) return help('condition', 'Which supported eBay condition matches the actual item? Choose one of the category-specific options and record its defects.', 'Choose item condition');
 if (/description/.test(text)) return help('description', 'What factual description should buyers see? Include what is present, condition, defects and any uncertain attribution.', 'Edit description');
 if (/title/.test(text)) return help('title', 'What factual title should buyers see? Use 3–80 characters and avoid claims you cannot support.', 'Edit listing title');
 if (/price|quantity|reserve|auction|postage|amount/.test(text)) return help('pricing', 'What selling price, quantity and format do you want? Use a positive price and whole quantity; an auction needs quantity one and a reserve above its start price.', 'Edit price and quantity');
 if (/safety|recall|expiry|expired|tester|not-for-sale|activation|locked|pressing|sleeve|grade/.test(text)) return help('safety', 'Resolve the specific product or specialist issue reported below. Confirm the actual facts in specialist tools; do not change a risk flag just to publish.', 'Review specialist facts');
 return help('retry', 'The service has not supplied a specific missing item field. Review its exact response below; no new identification or duplicate draft is required.', 'Review requirements and retry');
}
export function identificationPublicationAdvice(confidenceInput: unknown, stateInput: unknown, attributes: Record<string, any>): { confidence: number; questions: string[] } | null {
 const value = Number(confidenceInput), confidence = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
 if (confidence >= 0.95 && String(stateInput ?? '') !== 'observation_only') return null;
 const followUps = attributes._specialist_analysis?.followUps;
 const questions = strings(Array.isArray(followUps) ? followUps.map((entry: any) => entry?.question) : []);
 const missing = strings(attributes._identification_evidence?.missing);
 return { confidence, questions: (questions.length ? questions : missing).slice(0, 3) };
}
