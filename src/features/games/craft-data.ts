import type { CraftItem, CraftRecipe } from './types';

type Source = NonNullable<CraftRecipe['source']>;

// Sources support the historical connections, not the game's two-part formulas.
// Association recipes are prompts for comparison, never claims of inevitable causation.
const sources = {
  estates: {
    label: 'Château de Versailles · Estates General, 1789',
    url: 'https://en.chateauversailles.fr/discover/history/key-dates/summoning-estates-general-1789',
  },
  louis: {
    label: 'Château de Versailles · Louis XVI',
    url: 'https://en.chateauversailles.fr/discover/history/great-characters/louis-xvi',
  },
  assembly: {
    label: 'Château de Versailles · Versailles and the Revolution',
    url: 'https://en.chateauversailles.fr/discover/history/key-dates/versailles-heart-french-revolution',
  },
  oath: {
    label: 'Château de Versailles · Tennis Court Oath',
    url: 'https://en.chateauversailles.fr/discover/history/key-dates/jeu-paume-oath-1789',
  },
  bastille: {
    label: 'Élysée · 14 July 1789',
    url: 'https://www.elysee.fr/en/french-presidency/bastille-day-14-july',
  },
  declaration: {
    label: 'Élysée · Declaration of the Rights of Man and of the Citizen',
    url: 'https://www.elysee.fr/en/french-presidency/the-declaration-of-the-rights-of-man-and-of-the-citizen',
  },
  gouges: {
    label: 'Assemblée nationale · Olympe de Gouges, 1791',
    url: 'https://www.assemblee-nationale.fr/dyn/histoire-et-patrimoine/revolution-francaise/declaration-des-droits-de-la-femme-et-de-la-citoyenne-olympe-de-gouges',
  },
  napoleon: {
    label: 'Fondation Napoléon · The coup of 1799',
    url: 'https://www.napoleon.org/histoire-des-2-empires/dossiers-thematiques/le-coup-detat-des-18-et-19-brumaire-de-lan-viii-9-et-10-novembre-1799/',
  },
  civilCode: {
    label: 'Fondation Napoléon · The Civil Code, 1804',
    url: 'https://www.napoleon.org/en/young-historians/napodoc/les-masses-de-granit-de-nouvelles-institutions-napoleoniennes/',
  },
  italy: {
    label: 'MuseoTorino · Italian unification',
    url: 'https://www.museotorino.it/view/s/d4fbdea1f73644bcb084050b3cab4323',
  },
  risorgimento: {
    label: 'Italian Presidency · Cavour and Italian unification',
    url: 'https://presidenti.quirinale.it/Elementi/54681',
  },
  mazzini: {
    label: 'Italian Senate · Young Italy and the tricolour',
    url: 'https://www.senato.it/application/xmanager/projects/leg17/file/repository/relazioni/libreria/novita/XVII/Storia_del_Tricolore.pdf',
  },
  bismarck: {
    label: 'Deutsches Historisches Museum · Otto von Bismarck',
    url: 'https://www.dhm.de/lemo/biografie/otto-bismarck',
  },
  zollverein: {
    label: 'Deutsches Historisches Museum · 1834',
    url: 'https://www.dhm.de/lemo/jahreschronik/1834',
  },
  germany: {
    label: 'Deutsches Historisches Museum · German unification, 1871',
    url: 'https://www.dhm.de/lemo/kapitel/kaiserreich/reich/reichsgruendung',
  },
  japan: {
    label: 'National Diet Library · Early constitutional government',
    url: 'https://www.ndl.go.jp/modern/e/cha1/',
  },
  restoration: {
    label: 'National Diet Library · The change of government in 1868',
    url: 'https://www.ndl.go.jp/portrait/e/pickup/012/',
  },
  charterOath: {
    label: 'Columbia University · Charter Oath, 1868',
    url: 'https://afe.easia.columbia.edu/ps/japan/charter_oath_1868.pdf',
  },
  japanChronology: {
    label: 'National Diet Library · Chronology of modern Japan',
    url: 'https://www.ndl.go.jp/modern/e/utility/chronology.html',
  },
  iwakura: {
    label: 'National Diet Library · Iwakura Mission',
    url: 'https://www.ndl.go.jp/modern/e/cha1/description07.html',
  },
  meijiConstitution: {
    label: 'National Diet Library · Constitution of the Empire of Japan',
    url: 'https://www.ndl.go.jp/constitution/e/etc/c02.html',
  },
  constitutionDrafting: {
    label: 'National Diet Library · Drafting the Meiji Constitution',
    url: 'https://www.ndl.go.jp/modern/e/cha2/description07.html',
  },
  marx: {
    label: 'Deutsches Historisches Museum · Karl Marx',
    url: 'https://www.dhm.de/lemo/biografie/karl-marx',
  },
  workers: {
    label: 'Deutsches Historisches Museum · The workers’ movement',
    url: 'https://www.dhm.de/lemo/kapitel/kaiserreich/innenpolitik/arbeiterbewegung',
  },
  lenin: {
    label: 'Deutsches Historisches Museum · Vladimir Lenin',
    url: 'https://www.dhm.de/lemo/biografie/wladimir-lenin',
  },
  russianRevolution: {
    label: 'Deutsches Historisches Museum · Russian Revolution',
    url: 'https://www.dhm.de/lemo/kapitel/erster-weltkrieg/kriegsverlauf/russische-revolution',
  },
  stalin: {
    label: 'Deutsches Historisches Museum · Joseph Stalin',
    url: 'https://www.dhm.de/lemo/biografie/josef-stalin',
  },
  fiveYearPlan: {
    label: 'Library of Congress · Collectivisation and industrialisation',
    url: 'https://www.loc.gov/exhibits/archives/intn.html#obj8',
  },
  fascism: {
    label: 'US Holocaust Memorial Museum · Fascism',
    url: 'https://encyclopedia.ushmm.org/content/en/article/fascism-1',
  },
  mussolini: {
    label: 'US Holocaust Memorial Museum · Benito Mussolini',
    url: 'https://encyclopedia.ushmm.org/content/en/article/benito-mussolini-1',
  },
  hitler: {
    label: 'US Holocaust Memorial Museum · The Nazi Party',
    url: 'https://encyclopedia.ushmm.org/content/en/article/the-nazi-party-1',
  },
  outbreak1914: {
    label: 'National Army Museum · The crisis of 1914',
    url: 'https://www.nam.ac.uk/explore/to-arms-1914',
  },
  versailles: {
    label: 'UN Geneva · Treaty of Versailles and League Covenant',
    url: 'https://www.ungeneva.org/en/about/league-of-nations/covenant',
  },
  league: {
    label: 'UN Geneva · The League of Nations',
    url: 'https://www.ungeneva.org/en/library-archives/library/history',
  },
  pact: {
    label: 'US Holocaust Memorial Museum · German–Soviet Pact',
    url: 'https://encyclopedia.ushmm.org/content/en/article/german-soviet-pact',
  },
  poland: {
    label: 'US Holocaust Memorial Museum · Invasion of Poland, 1939',
    url: 'https://encyclopedia.ushmm.org/content/en/article/invasion-of-poland-fall-1939',
  },
} satisfies Record<string, Source>;

const item = (
  id: string, label: string, icon: string, category: CraftItem['category'], description: string,
): CraftItem => ({ id, label, icon, category, description });

export const starterIds: string[] = [
  'people', 'land', 'ideas', 'power', 'trade', 'technology', 'belief', 'resources',
];

export const craftItems: CraftItem[] = [
  item('people', 'People', '👥', 'foundation', 'Individuals and communities who made choices within the circumstances of their time.'),
  item('land', 'Land', '🌍', 'foundation', 'Places, environments and territory: the setting for human history.'),
  item('ideas', 'Ideas', '💡', 'foundation', 'Arguments and imagined possibilities that people shared, disputed and changed.'),
  item('power', 'Power', '⚖', 'foundation', 'The ability to shape decisions, institutions and other people’s lives.'),
  item('trade', 'Trade', '↔', 'foundation', 'Exchange that connected people, goods and markets.'),
  item('technology', 'Technology', '⚙', 'foundation', 'Tools and practical knowledge, from printing to industrial machinery.'),
  item('belief', 'Belief', '✦', 'foundation', 'Convictions about the world, including religious and political commitments.'),
  item('resources', 'Resources', '⛏', 'foundation', 'Materials, energy and wealth that societies used and contested.'),

  item('community', 'Community', '⌂', 'society', 'A group linked by relationships, shared places or common purposes.'),
  item('agriculture', 'Agriculture', '🌾', 'technology', 'Cultivating crops and keeping animals for food and other products.'),
  item('city', 'City', '▥', 'society', 'A concentrated settlement with intersecting economic, social and political lives.'),
  item('state', 'State', '🏛', 'society', 'Institutions claiming authority over a population and territory.'),
  item('monarchy', 'Monarchy', '♔', 'society', 'A political system with a monarch as head of state; the monarch’s powers vary.'),
  item('army', 'Army', '🛡', 'society', 'An organised military force whose members, command and political roles vary by society.'),
  item('taxes', 'Taxes', '¤', 'idea', 'Compulsory contributions used to finance public authority and its activities.'),
  item('public-debt', 'Public debt', '📒', 'idea', 'Money owed by a government after borrowing; creditors, taxation and repayment shape political choices.'),
  item('reason', 'Reason', '∴', 'idea', 'The use of argument and evidence to examine claims.'),
  item('enlightenment', 'Enlightenment', '☀', 'idea', 'Diverse intellectual movements that examined knowledge, rights, religion and government through critical inquiry.'),
  item('rights', 'Rights', '§', 'idea', 'Claims to freedoms, protections or entitlements; their scope and enforcement are contested.'),
  item('constitution', 'Constitution', '📜', 'idea', 'Rules defining a political order; a constitution alone does not guarantee democracy.'),
  item('nationalism', 'Nationalism', '⚑', 'idea', 'Ideas and movements that place the nation at the centre of political belonging and authority.'),
  item('diplomacy', 'Diplomacy', '✉', 'idea', 'Negotiation and communication between political authorities.'),
  item('alliance', 'Alliance', '⛓', 'idea', 'An agreement to cooperate, often with particular promises about security or war.'),
  item('war', 'War', '⚔', 'event', 'Organised armed conflict with consequences for civilians as well as combatants.'),
  item('propaganda', 'Propaganda', '📣', 'idea', 'Communication designed to shape attitudes and behaviour in support of a cause or authority.'),
  item('censorship', 'Censorship', '▰', 'idea', 'The restriction or suppression of expression and access to information.'),
  item('industrialisation', 'Industrialisation', '⚙', 'event', 'The expansion of mechanised production, accompanied by changes in work, energy use and society.'),
  item('railway', 'Railway', '🚂', 'technology', 'A transport network that connects places using vehicles running on rails.'),
  item('newspaper', 'Newspaper', '📰', 'technology', 'A publication carrying news and argument; its ownership, audience and freedom matter.'),
  item('revolution', 'Revolution', '↻', 'event', 'A major challenge to an existing political or social order, with outcomes that remain contingent.'),
  item('republic', 'Republic', '🏛', 'society', 'A state whose headship is not hereditary monarchy; republics can be democratic or authoritarian.'),
  item('workers', 'Industrial workers', '⚒', 'society', 'People whose labour sustained industrial production and who organised in varied ways.'),
  item('socialism', 'Socialism', '◈', 'idea', 'A varied family of ideas advocating social ownership or control of production and greater economic equality.'),
  item('dictatorship', 'Dictatorship', '▣', 'society', 'Concentrated rule with few effective checks and restricted political opposition.'),
  item('empire', 'Empire', '🗺', 'society', 'An unequal political order in which a centre rules or dominates other territories and peoples.'),
  item('reform', 'Reform', '✎', 'idea', 'An attempt to change institutions or practices within an existing political framework.'),

  item('france', 'France', 'FR', 'society', 'The French case study: monarchy, revolution and the contested meaning of citizenship.'),
  item('louis-xvi', 'Louis XVI', '👤', 'person', 'The king who called the Estates General amid the financial and political crisis of 1789.'),
  item('estates-general', 'Estates General', 'Ⅲ', 'event', 'The assembly of clergy, nobility and commoners that opened at Versailles on 5 May 1789.'),
  item('national-assembly', 'National Assembly', '🏛', 'society', 'The body formed by Third Estate deputies and allies on 17 June 1789.'),
  item('tennis-court-oath', 'Tennis Court Oath', '✋', 'event', 'The deputies’ pledge of 20 June 1789 to remain assembled until France had a constitution.'),
  item('bastille', 'Storming of the Bastille', '🏰', 'event', 'The capture of the Paris fortress on 14 July 1789 during a wider political crisis.'),
  item('french-revolution', 'French Revolution', '↻', 'event', 'The upheaval beginning in 1789 that transformed French political authority and citizenship.'),
  item('rights-declaration', 'Rights of Man, 1789', '📜', 'idea', 'The Declaration of the Rights of Man and of the Citizen, adopted in August 1789.'),
  item('olympe-de-gouges', 'Olympe de Gouges', '👤', 'person', 'The writer who challenged women’s exclusion from equal political rights in 1791.'),
  item('womens-declaration', 'Rights of Woman, 1791', '📜', 'idea', 'De Gouges’ Declaration of the Rights of Woman and of the Female Citizen, demanding equality.'),
  item('napoleon', 'Napoleon Bonaparte', '👤', 'person', 'The general who became First Consul after the coup of November 1799.'),
  item('civil-code', 'Civil Code, 1804', '📕', 'idea', 'A unified French civil law code that also reinforced male authority within the family.'),

  item('italy', 'Italy', 'IT', 'society', 'The Italian case study: rival plans, popular movements, diplomacy and wars of unification.'),
  item('mazzini', 'Giuseppe Mazzini', '👤', 'person', 'A republican nationalist who founded Young Italy in 1831.'),
  item('garibaldi', 'Giuseppe Garibaldi', '👤', 'person', 'The volunteer commander associated with the Expedition of the Thousand in 1860.'),
  item('cavour', 'Camillo di Cavour', '👤', 'person', 'The Piedmontese statesman whose diplomacy helped shape Italian unification under the monarchy.'),
  item('thousand', 'Expedition of the Thousand', '⛵', 'event', 'Garibaldi’s volunteer expedition to Sicily and southern Italy in 1860.'),
  item('italian-unification', 'Kingdom of Italy, 1861', 'IT', 'event', 'The kingdom proclaimed in March 1861; further territorial unification followed later.'),
  item('prussia', 'Prussia', 'PR', 'society', 'The monarchy that led the creation of the German Empire in 1871.'),
  item('bismarck', 'Otto von Bismarck', '👤', 'person', 'Prussian minister-president from 1862 and the first chancellor of the German Empire.'),
  item('zollverein', 'Zollverein', '↔', 'society', 'The German customs union whose founding treaties took effect in 1834, excluding Austria.'),
  item('german-unification', 'German unification, 1871', 'DE', 'event', 'The creation of the German Empire under Prussian leadership, excluding Austria.'),

  item('japan', 'Japan', 'JP', 'society', 'The Japanese case study: foreign pressure, political transformation and competing paths to reform.'),
  item('shogunate', 'Tokugawa shogunate', '🏯', 'society', 'The military government replaced during the political transformation of 1867–1868.'),
  item('emperor-meiji', 'Emperor Meiji', '👤', 'person', 'The emperor in whose name the new government transformed Japan after the Restoration.'),
  item('meiji-restoration', 'Meiji Restoration', '↻', 'event', 'The 1868 change from Tokugawa rule to the new Meiji government.'),
  item('charter-oath', 'Charter Oath, 1868', '📜', 'idea', 'A statement of the new government’s aims, including deliberation and the pursuit of knowledge.'),
  item('iwakura-mission', 'Iwakura Mission', '⛵', 'event', 'The Japanese mission of 1871–1873 that examined overseas institutions and pursued treaty revision.'),
  item('meiji-constitution', 'Meiji Constitution', '📜', 'idea', 'The constitution promulgated in 1889, combining imperial sovereignty with an Imperial Diet.'),

  item('marx', 'Karl Marx', '👤', 'person', 'A critic of capitalism who co-authored the Communist Manifesto with Friedrich Engels in 1848.'),
  item('lenin', 'Vladimir Lenin', '👤', 'person', 'The Bolshevik leader whose government suppressed political opponents after taking power in 1917.'),
  item('russian-revolution', 'Russian Revolutions, 1917', '↻', 'event', 'The fall of the tsar in the February Revolution and the Bolshevik takeover in October, using Russia’s calendar.'),
  item('soviet-union', 'Soviet Union', 'SU', 'society', 'The union established in 1922 after revolution and civil war, dominated by the Communist Party.'),
  item('stalin', 'Joseph Stalin', '👤', 'person', 'The Soviet dictator whose rule involved mass repression, forced collectivisation and rapid industrialisation.'),
  item('five-year-plan', 'First Five-Year Plan', '▥', 'event', 'The Soviet industrialisation programme begun in 1928, pursued with coercion and severe human costs.'),
  item('fascism', 'Fascism', '▣', 'idea', 'An authoritarian, ultranationalist political ideology hostile to democracy and pluralism.'),
  item('mussolini', 'Benito Mussolini', '👤', 'person', 'The founder of Italian Fascism who became prime minister in 1922 and consolidated a dictatorship.'),
  item('hitler', 'Adolf Hitler', '👤', 'person', 'The Nazi leader whose racist dictatorship pursued aggressive war, persecution and genocide.'),
  item('world-war-one', 'First World War', '⚔', 'event', 'The global war of 1914–1918, involving rival alliances and imperial forces.'),
  item('treaty-versailles', 'Treaty of Versailles', '📜', 'event', 'The peace treaty with Germany signed on 28 June 1919, including the League Covenant.'),
  item('league-nations', 'League of Nations', '◉', 'society', 'The international organisation established in 1920 to pursue cooperation and collective security.'),
  item('nazi-soviet-pact', 'Nazi–Soviet Pact', '📜', 'event', 'The agreement of 23 August 1939, including a secret division of eastern European spheres of influence.'),
  item('invasion-poland', 'Invasion of Poland, 1939', '🗺', 'event', 'Germany invaded on 1 September; the Soviet Union invaded from the east on 17 September.'),
  item('world-war-two', 'WWII: Europe, 1939', '⚔', 'event', 'The European outbreak of the global Second World War in September 1939.'),
];

function association(
  a: string, b: string, result: string, explanation: string, source?: Source,
): CraftRecipe {
  return { ingredients: [a, b], result, explanation, kind: 'association', ...(source ? { source } : {}) };
}

function historical(
  a: string, b: string, result: string, explanation: string, source: Source,
): CraftRecipe {
  return { ingredients: [a, b], result, explanation, kind: 'history', source };
}

export const craftRecipes: CraftRecipe[] = [
  // Reusable foundations. These teach concepts without inventing specific events.
  association('people', 'people', 'community', 'Bring people together to explore a community: its relationships matter as much as its size.'),
  association('land', 'people', 'agriculture', 'A conceptual route from people and their environment to cultivating food.'),
  association('community', 'trade', 'city', 'Explore the exchange networks of a city. Trade is one part of urban life, not a complete explanation of its origins.'),
  association('community', 'power', 'state', 'A prompt to ask how authority becomes organised through institutions.'),
  association('state', 'belief', 'monarchy', 'Explore beliefs that can legitimise a monarch. Religious belief can also support other political orders.'),
  association('people', 'power', 'army', 'People organised for military power give us a route to armies and their political roles.'),
  association('state', 'trade', 'taxes', 'Think about how authorities raise revenue from economic activity.'),
  association('state', 'resources', 'public-debt', 'How might a government finance commitments beyond its current resources? Borrowing is one possible answer.'),
  association('ideas', 'ideas', 'reason', 'Let ideas test other ideas: compare the evidence and the logic behind a claim.'),
  association('reason', 'power', 'enlightenment', 'A route into Enlightenment questions about authority, knowledge and rights.'),
  association('people', 'ideas', 'rights', 'Explore ideas about the freedoms and protections that people should possess.'),
  association('rights', 'state', 'constitution', 'Put rights beside institutions to investigate what a constitution promises and how power is limited.'),
  association('community', 'land', 'nationalism', 'A prompt about people, territory and national belonging. Nations are not simply products of geography.'),
  association('state', 'ideas', 'diplomacy', 'Turn political aims into negotiation: what can states agree, and where do their interests conflict?'),
  association('diplomacy', 'state', 'alliance', 'Negotiations may produce an alliance, with terms that need careful reading.'),
  association('army', 'land', 'war', 'A prompt about military force and territory. Their combination does not make war inevitable.'),
  association('power', 'ideas', 'propaganda', 'Examine attempts to shape opinion in the service of power.'),
  association('power', 'newspaper', 'censorship', 'Who can publish, and who can prevent publication? This route explores control over information.'),
  association('technology', 'resources', 'industrialisation', 'Connect machinery, materials and energy to investigate industrial change.'),
  association('industrialisation', 'land', 'railway', 'Lay a conceptual track between industrial production and transport across territory.'),
  association('technology', 'ideas', 'newspaper', 'Printing and circulating ideas opens a route to newspapers and their audiences.'),
  association('rights', 'power', 'revolution', 'A prompt about conflicts over political rights. Such conflicts can also lead to reform or continued repression.'),
  association('rights', 'constitution', 'republic', 'Explore one possible constitutional order. Neither rights nor a written constitution automatically creates a republic.'),
  association('people', 'industrialisation', 'workers', 'Place the people doing industrial labour at the centre of the story.'),
  association('workers', 'ideas', 'socialism', 'Explore one family of responses to inequality and ownership; workers held many different political views.'),
  association('power', 'power', 'dictatorship', 'A game metaphor for concentrated power with too few effective checks.'),
  association('state', 'land', 'empire', 'A prompt about a political centre ruling other territories, and the unequal relationships that follow.'),
  association('state', 'reason', 'reform', 'Examine an institution, then consider how people might change it.'),

  // Country tiles are doorways into case studies, not formulas for creating nations.
  association('enlightenment', 'monarchy', 'france', 'This pair opens the French case study, where new claims about authority confronted royal government.', sources.declaration),
  association('nationalism', 'republic', 'italy', 'This pair opens the Italian case study. Republican movements and monarchical state-building pursued different versions of unity.', sources.risorgimento),
  association('army', 'monarchy', 'prussia', 'This route introduces Prussia, where royal government and military power shaped the unification process.', sources.bismarck),
  association('trade', 'reform', 'japan', 'This route introduces nineteenth-century Japan and debates prompted by foreign relations. It does not describe Japan’s origins.', sources.japan),

  historical('france', 'monarchy', 'louis-xvi', 'Louis XVI was king when financial crisis led him to summon the Estates General in 1789.', sources.louis),
  historical('louis-xvi', 'public-debt', 'estates-general', 'The monarchy’s financial crisis helped bring the Estates General to Versailles on 5 May 1789.', sources.estates),
  historical('estates-general', 'rights', 'national-assembly', 'Third Estate deputies and allies asserted a new representative authority by forming the National Assembly on 17 June 1789.', sources.assembly),
  historical('national-assembly', 'constitution', 'tennis-court-oath', 'On 20 June 1789, the deputies pledged to remain together until a constitution was established.', sources.oath),
  historical('france', 'revolution', 'bastille', 'Parisians captured the Bastille on 14 July 1789 amid fears of royal troops and shortages.', sources.bastille),
  historical('bastille', 'tennis-court-oath', 'french-revolution', 'These were two connected moments in 1789: a challenge by deputies and an uprising in Paris. Neither alone explains the Revolution.', sources.assembly),
  historical('national-assembly', 'rights', 'rights-declaration', 'The Constituent Assembly adopted the Declaration of the Rights of Man and of the Citizen in August 1789.', sources.declaration),
  historical('rights-declaration', 'people', 'olympe-de-gouges', 'De Gouges challenged the exclusion of women by recasting the language of the 1789 declaration in 1791.', sources.gouges),
  historical('olympe-de-gouges', 'rights', 'womens-declaration', 'In 1791, de Gouges demanded women’s equal rights, including political participation, in her Declaration of the Rights of Woman.', sources.gouges),
  historical('french-revolution', 'army', 'napoleon', 'The revolutionary general took power in the coup of 9–10 November 1799. Military prominence was only part of his rise.', sources.napoleon),
  historical('napoleon', 'constitution', 'civil-code', 'This connection turns from political institutions to civil law: the code of 1804 unified French law while reinforcing male household authority.', sources.civilCode),

  historical('italy', 'ideas', 'mazzini', 'Mazzini’s Young Italy, founded in 1831, promoted an Italian national cause through organised political activity.', sources.mazzini),
  historical('italy', 'army', 'garibaldi', 'Garibaldi led volunteers whose campaigns made a major contribution to Italian unification.', sources.risorgimento),
  historical('italy', 'diplomacy', 'cavour', 'Cavour pursued unification through Piedmontese government and diplomacy, alongside movements he could not simply command.', sources.risorgimento),
  historical('garibaldi', 'people', 'thousand', 'Garibaldi’s volunteers sailed for Sicily in May 1860 and then advanced through southern Italy.', sources.risorgimento),
  historical('thousand', 'cavour', 'italian-unification', 'Volunteer conquest and state diplomacy converged in the Kingdom of Italy in 1861. Their leaders differed over means and ends.', sources.risorgimento),
  historical('prussia', 'diplomacy', 'bismarck', 'The diplomat Bismarck became Prussian minister-president in 1862, during a constitutional conflict over army spending.', sources.bismarck),
  historical('prussia', 'trade', 'zollverein', 'The customs union that took effect in 1834 reduced internal tariffs among its members; Austria remained outside.', sources.zollverein),
  historical('bismarck', 'nationalism', 'german-unification', 'Bismarck combined diplomacy and war with national politics. The German Empire was proclaimed in January 1871.', sources.germany),

  historical('japan', 'army', 'shogunate', 'The Tokugawa shogunate was the government displaced by the transition to Meiji rule in 1867–1868.', sources.japanChronology),
  historical('japan', 'monarchy', 'emperor-meiji', 'The new government claimed restored imperial authority in 1868; this did not mean that the emperor personally directed every reform.', sources.japanChronology),
  historical('shogunate', 'reform', 'meiji-restoration', 'The Restoration of 1868 replaced the shogunate. The new government also recruited people who had served the old regime.', sources.restoration),
  historical('meiji-restoration', 'ideas', 'charter-oath', 'The Charter Oath of 1868 set out reforming aims, including deliberative assemblies and wider learning.', sources.charterOath),
  historical('meiji-restoration', 'diplomacy', 'iwakura-mission', 'The mission of 1871–1873 studied institutions abroad and sought preparations for treaty revision.', sources.iwakura),
  historical('meiji-restoration', 'constitution', 'meiji-constitution', 'The constitution promulgated in 1889 created an Imperial Diet while locating sovereignty in the emperor.', sources.meijiConstitution),

  historical('socialism', 'newspaper', 'marx', 'Marx worked as a journalist and, with Engels, developed an influential critique of capitalism.', sources.marx),
  historical('marx', 'revolution', 'lenin', 'Lenin developed his own revolutionary politics from Marxist ideas. This was an interpretation, not the inevitable outcome of Marx’s writing.', sources.lenin),
  historical('lenin', 'war', 'russian-revolution', 'Russia’s wartime crisis formed the setting for the revolutions of 1917. Lenin led the Bolsheviks, one movement among competing forces.', sources.russianRevolution),
  historical('russian-revolution', 'state', 'soviet-union', 'The Soviet Union was established in 1922 after the revolutions and a destructive civil war.', sources.russianRevolution),
  historical('soviet-union', 'dictatorship', 'stalin', 'Stalin consolidated personal power and used repression against real and imagined opponents.', sources.stalin),
  historical('stalin', 'industrialisation', 'five-year-plan', 'The First Five-Year Plan began in 1928. Heavy industrial targets were pursued alongside coercive collectivisation and devastating human suffering.', sources.fiveYearPlan),
  association('nationalism', 'dictatorship', 'fascism', 'These concepts help introduce fascism, but neither all nationalism nor all dictatorships are fascist. Its anti-democratic, ultranationalist programme matters.', sources.fascism),
  historical('italy', 'fascism', 'mussolini', 'Mussolini founded the Italian Fascist movement and became prime minister in 1922, then consolidated dictatorship.', sources.mussolini),
  association('fascism', 'propaganda', 'hitler', 'A route to studying Nazi leadership. Hitler’s rise also depended on elite decisions, crises, intimidation and state violence.', sources.hitler),
  historical('war', 'alliance', 'world-war-one', 'Rival alliances helped widen the 1914 crisis after the Sarajevo assassination. Decisions by leaders still mattered; war was not automatic.', sources.outbreak1914),
  historical('world-war-one', 'diplomacy', 'treaty-versailles', 'The treaty with Germany was signed on 28 June 1919 as part of the wider peace settlement.', sources.versailles),
  historical('treaty-versailles', 'ideas', 'league-nations', 'The League Covenant formed part of the peace settlement. The organisation began in 1920 with ambitions for collective security.', sources.league),
  historical('hitler', 'stalin', 'nazi-soviet-pact', 'Their governments concluded the pact on 23 August 1939 through Molotov and Ribbentrop, secretly dividing spheres of influence in eastern Europe.', sources.pact),
  historical('hitler', 'war', 'invasion-poland', 'Germany invaded Poland on 1 September 1939. The Soviet Union invaded on 17 September; the two occupiers partitioned the country.', sources.poland),
  historical('nazi-soviet-pact', 'invasion-poland', 'world-war-two', 'The pact enabled aggression against Poland. Germany’s invasion prompted British and French declarations of war on 3 September: the European outbreak of WWII.', sources.pact),

  // Alternate paths reward related ideas rather than requiring one hidden chain.
  association('agriculture', 'technology', 'industrialisation', 'Compare mechanised agriculture with wider industrial change. New machines alone do not explain the whole process.'),
  association('city', 'technology', 'industrialisation', 'Use the city as a lens on factories, infrastructure and changing patterns of work.'),
  association('army', 'trade', 'public-debt', 'Financing military commitments opens a question about borrowing and revenue; debt is one possible fiscal choice.'),
  association('state', 'newspaper', 'propaganda', 'Investigate how an authority might use the press to shape opinion, without assuming that every newspaper is propaganda.'),
  association('army', 'resources', 'war', 'A prompt about the material demands of armed conflict and competition over resources, not a prediction of war.'),
  association('empire', 'army', 'war', 'Examine the relationship between imperial power and military force, including the experiences of those who resisted.'),
  association('people', 'constitution', 'rights', 'Ask whose rights a constitution recognises, whose it excludes and how its promises are enforced.'),
  association('enlightenment', 'constitution', 'rights', 'Explore the language of rights used to debate legitimate government.'),
  association('state', 'constitution', 'reform', 'A constitutional revision is one possible path to reform, and may widen or restrict political participation.'),
  association('newspaper', 'rights', 'reform', 'Public argument can open debates about reform; its effects depend on audiences and political conditions.'),
  historical('workers', 'rights', 'socialism', 'Socialists were among those who organised for workers’ interests, alongside other movements and traditions.', sources.workers),
  association('people', 'dictatorship', 'revolution', 'A prompt to investigate resistance to dictatorship. Resistance does not always produce a revolution or succeed.'),
  historical('enlightenment', 'france', 'rights-declaration', 'Enlightenment ideas influenced the 1789 declaration, alongside the American example and French political struggles.', sources.declaration),
  historical('louis-xvi', 'taxes', 'estates-general', 'The king called representatives to address a financial crisis and proposed reforms; disputes soon moved beyond taxation.', sources.estates),
  historical('estates-general', 'constitution', 'national-assembly', 'The deputies’ dispute over representation produced a National Assembly that claimed authority to remake the political order.', sources.assembly),
  historical('bastille', 'national-assembly', 'french-revolution', 'Popular action in Paris and the deputies’ political challenge were connected strands of the Revolution of 1789.', sources.assembly),
  historical('olympe-de-gouges', 'constitution', 'womens-declaration', 'De Gouges demanded that constitutional equality include women, not only men.', sources.gouges),
  historical('napoleon', 'rights', 'civil-code', 'The 1804 code retained some revolutionary changes but restricted women’s position. Legal unification was not equal rights for everyone.', sources.civilCode),
  association('italy', 'nationalism', 'italian-unification', 'A route to the kingdom created in March 1861. Shared national aims did not erase disagreements or make unity inevitable.', sources.italy),
  historical('garibaldi', 'cavour', 'italian-unification', 'Their different campaigns contributed to the 1861 kingdom; neither worked alone, and their political preferences differed.', sources.risorgimento),
  association('bismarck', 'zollverein', 'german-unification', 'Compare economic integration with political unification. The earlier customs union was not itself the German Empire.', sources.zollverein),
  historical('bismarck', 'army', 'german-unification', 'Wars against Denmark, Austria and France formed part of the Prussian-led unification process, together with diplomacy.', sources.bismarck),
  historical('japan', 'reform', 'meiji-restoration', 'The change of government in 1868 opened a period of transformation, drawing on both new leaders and former shogunate officials.', sources.restoration),
  historical('emperor-meiji', 'ideas', 'charter-oath', 'Issued in the emperor’s name in 1868, the oath announced the new government’s aims rather than a finished parliamentary system.', sources.charterOath),
  historical('japan', 'diplomacy', 'iwakura-mission', 'Japanese envoys travelled through the United States and Europe in 1871–1873, studying institutions and treaty relations.', sources.iwakura),
  historical('emperor-meiji', 'constitution', 'meiji-constitution', 'The 1889 text placed sovereignty in the emperor and required laws to involve the Imperial Diet.', sources.meijiConstitution),
  association('iwakura-mission', 'constitution', 'meiji-constitution', 'Overseas study is a route into this constitutional story; the final text emerged from later drafting and political choices.', sources.constitutionDrafting),
  historical('workers', 'newspaper', 'marx', 'Marx wrote for newspapers and helped organise political activity, connecting economic criticism with public argument.', sources.marx),
  historical('lenin', 'world-war-one', 'russian-revolution', 'Lenin returned to Russia in 1917 and pressed for peace and Bolshevik power during the wartime crisis.', sources.lenin),
  association('soviet-union', 'industrialisation', 'five-year-plan', 'This pair selects the Soviet programme begun in 1928. Its methods and human costs were specific political choices.', sources.fiveYearPlan),
  association('propaganda', 'censorship', 'dictatorship', 'Compare two tools used to control information. Their presence alone does not explain how a dictatorship arises or survives.'),
  historical('hitler', 'diplomacy', 'nazi-soviet-pact', 'This diplomatic connection selects the 1939 agreement with Stalin’s government; it was a temporary arrangement, not lasting reconciliation.', sources.pact),
  historical('invasion-poland', 'alliance', 'world-war-two', 'Britain and France declared war on Germany on 3 September 1939 following the attack on Poland and their commitments to it.', sources.poland),
  association('war', 'diplomacy', 'league-nations', 'The League was one historical response to the devastation of the First World War, aimed at cooperation and collective security.', sources.league),
  historical('bismarck', 'italy', 'alliance', 'Prussia and Italy concluded an alliance in April 1866 in advance of war against Austria.', sources.bismarck),
  historical('iwakura-mission', 'prussia', 'reform', 'Itō Hirobumi’s diary from March 1873 recorded Prussian parliamentary and electoral institutions for study.', sources.iwakura),
];
