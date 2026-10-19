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
  confederation: {
    label: 'The Canadian Encyclopedia · Confederation',
    url: 'https://thecanadianencyclopedia.ca/en/article/confederation',
  },
  canadaWar: {
    label: 'Canadian War Museum · Canada enters the war',
    url: 'https://www.warmuseum.ca/firstworldwar/history/going-to-war/canada-enters-the-war/',
  },
  ypres: {
    label: 'The Canadian Encyclopedia · Second Battle of Ypres',
    url: 'https://thecanadianencyclopedia.ca/en/article/battle-of-ypres',
  },
  flanders: {
    label: 'The Canadian Encyclopedia · In Flanders Fields',
    url: 'https://thecanadianencyclopedia.ca/en/article/in-flanders-fields',
  },
  somme: {
    label: 'The Canadian Encyclopedia · Battle of the Somme',
    url: 'https://thecanadianencyclopedia.ca/en/article/battle-of-the-somme',
  },
  beaumontHamel: {
    label: 'Veterans Affairs Canada · Battle of Beaumont-Hamel',
    url: 'https://veterans.gc.ca/en/remembrance/military-history/first-world-war/battle-beaumont-hamel',
  },
  vimy: {
    label: 'The Canadian Encyclopedia · Battle of Vimy Ridge',
    url: 'https://thecanadianencyclopedia.ca/en/article/vimy-ridge',
  },
  conscription: {
    label: 'The Canadian Encyclopedia · Military Service Act',
    url: 'https://thecanadianencyclopedia.ca/en/article/military-service-act',
  },
  hockey: {
    label: 'The Canadian Encyclopedia · Origins of ice hockey',
    url: 'https://thecanadianencyclopedia.ca/en/article/origins-of-ice-hockey',
  },
  toronto: {
    label: 'The Canadian Encyclopedia · Toronto',
    url: 'https://thecanadianencyclopedia.ca/en/article/toronto',
  },
  leafs: {
    label: 'NHL.com · The 1967 Maple Leafs',
    url: 'https://www.nhl.com/news/1967-toronto-maple-leafs-retrospective-part-2',
  },
  louisTrial: {
    label: 'Assemblée nationale · Trial and execution of Louis XVI',
    url: 'https://www.assemblee-nationale.fr/dyn/histoire-et-patrimoine/revolution-francaise/proces-et-execution-de-louis-xvi',
  },
  vienna: {
    label: 'Fondation Napoléon · The Congress of Vienna',
    url: 'https://www.napoleon.org/en/history-of-the-two-empires/articles/did-the-congress-of-vienna-undo-everything-napoleon-had-achieved/',
  },
  waterloo: {
    label: 'Fondation Napoléon · Consulate and Empire timeline',
    url: 'https://www.napoleon.org/en/young-historians/napodoc/timeline-consulate1st-french-empire/',
  },
  napoleon3: {
    label: 'Fondation Napoléon · Napoleon III',
    url: 'https://www.napoleon.org/en/young-historians/napodoc/napoleon-iii-emperor-of-the-french-1808-1873/',
  },
  revolution1848: {
    label: 'Deutsches Historisches Museum · The revolution of 1848/49',
    url: 'https://www.dhm.de/lemo/kapitel/vormaerz-und-revolution/revolution-1848',
  },
  frankfurt: {
    label: 'German Bundestag · The National Assembly in Frankfurt',
    url: 'https://www.bundestag.de/en/parliament/history/parliamentarism/1848/1848-200350',
  },
  war1866: {
    label: 'Deutsches Historisches Museum · The German War of 1866',
    url: 'https://www.dhm.de/lemo/kapitel/reaktionszeit/deutscherbund/deutschekrieg',
  },
  war1870: {
    label: 'Deutsches Historisches Museum · The Franco-Prussian War',
    url: 'https://www.dhm.de/lemo/kapitel/kaiserreich/reich/krieg1870',
  },
  compromise: {
    label: 'Austrian Parliament · The Compromise of 1867',
    url: 'https://www.parlament.gv.at/verstehen/historisches/1848-1918/abschied-kaiserreich/index.html',
  },
  budapest: {
    label: 'Budapest City Archives · 150 years of Budapest',
    url: 'https://bparchiv.hu/150-eves-budapest/',
  },
  weimar: {
    label: 'German Bundestag · The Weimar constitution, 1919',
    url: 'https://www.bundestag.de/dokumente/textarchiv/1919-07-31-reichsverfassung-652448',
  },
  reichstagFire: {
    label: 'US Holocaust Memorial Museum · Reichstag Fire Decree',
    url: 'https://encyclopedia.ushmm.org/content/en/article/reichstag-fire-decree',
  },
  enablingAct: {
    label: 'US Holocaust Memorial Museum · The Enabling Act',
    url: 'https://encyclopedia.ushmm.org/content/en/article/the-enabling-act',
  },
  gorbachev: {
    label: 'Office of the Historian · U.S.–Soviet relations, 1981–1991',
    url: 'https://history.state.gov/milestones/1981-1988/u.s.-soviet-relations',
  },
  gorbachevReforms: {
    label: 'Encyclopaedia Britannica · Mikhail Gorbachev',
    url: 'https://www.britannica.com/biography/Mikhail-Gorbachev',
  },
  fallCommunism: {
    label: 'Office of the Historian · Fall of communism in Eastern Europe',
    url: 'https://history.state.gov/milestones/1989-1992/fall-of-communism',
  },
  sovietCollapse: {
    label: 'Office of the Historian · The collapse of the Soviet Union',
    url: 'https://history.state.gov/milestones/1989-1992/collapse-soviet-union',
  },
  ecolint: {
    label: 'International School of Geneva · Our history',
    url: 'https://www.ecolint.ch/en/our-history',
  },
  ib: {
    label: 'International Baccalaureate · Key facts about the DP',
    url: 'https://www.ibo.org/programmes/diploma-programme/what-is-the-dp/key-facts-about-the-dp/',
  },
  department: {
    label: 'St. Robert Canadian and World Studies · Teachers',
    url: 'https://sites.google.com/ycdsbk12.ca/strobertcws/teachers',
  },
  woodProfile: {
    label: 'STR History · Mr. Wood’s profile',
    url: '/teachers/robert-wood',
  },
} satisfies Record<string, Source>;

const item = (
  id: string, label: string, icon: string, category: CraftItem['category'], description: string,
): CraftItem => ({ id, label, icon, category, description });

export const starterIds: string[] = [
  'people', 'land', 'ideas', 'power', 'trade', 'technology', 'belief', 'resources',
];

/** The item that completes the game: one of St. Robert's IB History teachers. */
export const goalId = 'mr-wood';
export const goalTeaser = 'One of St. Robert’s IB History teachers, Mr. Wood helps coach hockey, has Budapest on a travel bucket list and would share a drink with Napoleon. Every route there runs through history.';

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

  // Europe from the Revolution to unification, the HL study.
  item('execution-louis-xvi', 'Execution of Louis XVI', '⚖', 'event', 'The former king, tried by the National Convention, was guillotined in Paris on 21 January 1793.'),
  item('congress-vienna', 'Congress of Vienna', '✒', 'event', 'The congress of 1814–1815 at which the powers that had defeated Napoleon redrew the map of Europe.'),
  item('waterloo', 'Battle of Waterloo', '⚔', 'event', 'Napoleon’s final defeat, on 18 June 1815, by Wellington’s and Blücher’s armies.'),
  item('revolutions-1848', 'Revolutions of 1848', '↻', 'event', 'A wave of uprisings across Europe demanding nation states, constitutions and social reform; it was suppressed by 1849.'),
  item('frankfurt-parliament', 'Frankfurt Parliament', '🏛', 'society', 'The German National Assembly of 1848–1849, which met in St Paul’s Church and drafted a constitution for a united Germany.'),
  item('napoleon-iii', 'Napoleon III', '👤', 'person', 'Napoleon’s nephew: elected president of France in 1848, emperor from 1852, taken prisoner at Sedan in 1870.'),
  item('franco-prussian-war', 'Franco-Prussian War', '⚔', 'event', 'The war of 1870–1871 in which Prussia and its German allies defeated France.'),
  item('austrian-empire', 'Austrian Empire', 'AT', 'society', 'The multinational Habsburg empire ruled from Vienna, and Prussia’s rival for leadership in Germany.'),
  item('austro-prussian-war', 'Austro-Prussian War, 1866', '⚔', 'event', 'Prussia’s victory over Austria in 1866, which pushed Austria out of German affairs.'),
  item('austria-hungary', 'Austria-Hungary', 'AH', 'society', 'The Dual Monarchy created by the Compromise of 1867, with separate Austrian and Hungarian parliaments and governments.'),
  item('budapest', 'Budapest', '🌉', 'society', 'The Hungarian capital, created on 17 November 1873 by uniting Pest, Buda and Óbuda.'),

  // Authoritarian rule and the Soviet collapse, two of the current course's studies.
  item('weimar-republic', 'Weimar Republic', '🏛', 'society', 'Germany’s democratic republic, born of defeat and revolution in 1918; its constitution came into force in August 1919.'),
  item('reichstag-fire', 'Reichstag fire', '🔥', 'event', 'The fire at the parliament building in Berlin on 27 February 1933, which the Nazi government used to suspend constitutional rights.'),
  item('enabling-act', 'Enabling Act, 1933', '📜', 'event', 'The law of 23 March 1933 that let Hitler’s government make laws without parliament.'),
  item('gorbachev', 'Mikhail Gorbachev', '👤', 'person', 'The Soviet leader from 1985 to 1991, whose reforms loosened the Communist Party’s control.'),
  item('glasnost', 'Glasnost', '🔓', 'idea', 'Openness: Gorbachev’s policy of widening freedom of expression and information in the late 1980s.'),
  item('perestroika', 'Perestroika', '♻', 'idea', 'Restructuring: Gorbachev’s attempt to reform the planned economy and, increasingly, the political system.'),
  item('fall-berlin-wall', 'Fall of the Berlin Wall', '🧱', 'event', 'The opening of East Germany’s borders, the Berlin Wall included, on 9 November 1989.'),
  item('dissolution-ussr', 'End of the Soviet Union', '🧩', 'event', 'The collapse of the Soviet Union in December 1991, after the failed coup that August.'),

  // Canada and the First World War, the Grade 10 notes' subject.
  item('canada', 'Canada', 'CA', 'society', 'The Dominion created on 1 July 1867 from three British North American colonies; Indigenous peoples were not represented in the negotiations.'),
  item('canada-at-war', 'Canada at war, 1914', '🎖', 'event', 'Britain’s declaration of war on 4 August 1914 brought Canada, a Dominion of the British Empire, into the First World War.'),
  item('ypres-1915', 'Second Battle of Ypres', '☁', 'event', 'Canada’s first major battle, in Belgium in April and May 1915, where the German army used chlorine gas on a large scale.'),
  item('in-flanders-fields', 'In Flanders Fields', '✿', 'idea', 'John McCrae’s poem, written on 3 May 1915 during the Second Battle of Ypres.'),
  item('somme-1916', 'Battle of the Somme', '⚔', 'event', 'The British and French offensive of July to November 1916, in which Canadian and Newfoundland troops fought; Newfoundland was then a separate Dominion.'),
  item('vimy-ridge', 'Vimy Ridge, 1917', '⛰', 'event', 'The ridge captured on 9–12 April 1917 by the four divisions of the Canadian Corps, attacking together for the first time.'),
  item('conscription-crisis', 'Conscription Crisis, 1917', '⚖', 'event', 'The bitter division over the Military Service Act of 1917, which made compulsory military service law.'),
  item('hockey', 'Ice hockey', '🏒', 'society', 'Stick-and-ball games on ice are centuries old; the first recorded indoor hockey match was played in Montreal in 1875.'),
  item('toronto', 'Toronto', 'TO', 'society', 'The town of York, laid out in 1793, was incorporated as the City of Toronto in 1834.'),
  item('maple-leafs', 'Toronto Maple Leafs', '🍁', 'society', 'Toronto’s NHL club, named the Maple Leafs in 1927 and Stanley Cup champions in Canada’s centennial year, 1967.'),

  // The goal: Mr. Wood, by way of the League of Nations and the IB.
  item('school', 'School', '🏫', 'society', 'A community organised for teaching and learning; who could attend, and what was taught, changed over time.'),
  item('teacher', 'Teacher', '🍎', 'society', 'Someone whose work is helping others learn.'),
  item('international-school-geneva', 'International School of Geneva', '🌐', 'society', 'Founded in 1924 by League of Nations and International Labour Organization officials, together with local educators.'),
  item('international-baccalaureate', 'International Baccalaureate', '🎓', 'idea', 'An international education whose first programme, the IB Diploma, was established in 1968.'),
  item('ib-history-teacher', 'IB History teacher', '📚', 'society', 'A teacher who guides IB students through sources, essays and their own historical investigation.'),
  item('mr-wood', 'Mr. Wood', '👨‍🏫', 'person', 'One of St. Robert’s IB History teachers, an extended essay supervisor and an assistant hockey coach.'),
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

/** A connection with St. Robert's own history department, cited to its pages. */
function school(
  a: string, b: string, result: string, explanation: string, source: Source,
): CraftRecipe {
  return { ingredients: [a, b], result, explanation, kind: 'school', source };
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

  // Europe from the Revolution to unification.
  historical('louis-xvi', 'republic', 'execution-louis-xvi', 'In December 1792 the National Convention decided to try the former king itself. Louis XVI was guillotined on the place de la Révolution, today’s place de la Concorde in Paris, on 21 January 1793.', sources.louisTrial),
  historical('napoleon', 'diplomacy', 'congress-vienna', 'After Napoleon’s first abdication, the victorious allies met in Vienna to lay the foundations of a new Europe. Directed by Britain, Russia, Austria and Prussia, the congress closed with its Final Act on 9 June 1815, days before Waterloo.', sources.vienna),
  historical('napoleon', 'alliance', 'waterloo', 'Napoleon returned from exile on Elba in March 1815. Wellington’s army, joined by Blücher’s Prussians, defeated him at Waterloo on 18 June; four days later he abdicated for the second time.', sources.waterloo),
  historical('congress-vienna', 'revolution', 'revolutions-1848', 'The order restored in 1815 faced a wave of revolution in 1848. Starting in France, it spread to the German and Italian states and across the Austrian Empire, demanding nation states and constitutions, until its suppression in 1849.', sources.revolution1848),
  association('nationalism', 'revolution', 'revolutions-1848', 'Creating nation states was a central demand of many revolutionaries in 1848, alongside democratic government and social reform. All three aims failed when the revolutions were crushed in 1849.', sources.revolution1848),
  historical('revolutions-1848', 'constitution', 'frankfurt-parliament', 'Germany’s first parliament met in Frankfurt’s St Paul’s Church on 18 May 1848 and adopted a constitution for a united state in March 1849. In April 1849, Frederick William IV of Prussia declined the imperial crown it offered.', sources.frankfurt),
  historical('napoleon', 'revolutions-1848', 'napoleon-iii', 'Napoleon’s nephew Louis-Napoléon Bonaparte won France’s presidential election on 10 December 1848, seized power in a coup in December 1851 and became Emperor Napoleon III on 2 December 1852.', sources.napoleon3),
  historical('napoleon-iii', 'bismarck', 'franco-prussian-war', 'A dispute over the Spanish throne escalated after Bismarck’s provocative Ems Dispatch of 13 July 1870. Napoleon III declared war on Prussia on 19 July, and the southern German states sided with Prussia.', sources.war1870),
  historical('franco-prussian-war', 'prussia', 'german-unification', 'During the war, the southern German states joined the Prussian-led confederation by treaties of November 1870. Wilhelm I was proclaimed German Emperor in the Hall of Mirrors at Versailles on 18 January 1871.', sources.germany),
  association('monarchy', 'empire', 'austrian-empire', 'This pair opens the Habsburg case study: a multinational empire ruled from Vienna, and Prussia’s rival for leadership in Germany.'),
  historical('prussia', 'austrian-empire', 'austro-prussian-war', 'Allied with Italy since 8 April 1866, Prussia defeated Austria at Königgrätz on 3 July 1866. The Peace of Prague ended the German Confederation and pushed Austria out of Germany; Italy gained Venetia.', sources.war1866),
  historical('bismarck', 'austrian-empire', 'austro-prussian-war', 'Prussia’s minister-president, Bismarck, accused Austria of breaking their 1865 agreement over Schleswig and Holstein. The war that followed was decided at Königgrätz on 3 July 1866.', sources.war1866),
  historical('austro-prussian-war', 'reform', 'austria-hungary', 'Defeat by Prussia ended Austria’s great-power position in Germany and forced the emperor into far-reaching concessions to Hungary. In the Compromise of 1867, each half gained its own parliament and government; foreign policy, the army and the monarchy’s finances stayed joint.', sources.compromise),
  association('austrian-empire', 'nationalism', 'austria-hungary', 'Hungary’s refusal to accept a constitution for the whole empire helped force the Compromise of 1867. Other nationalities gained no equal settlement: one for the Czechs of Bohemia was discussed but never achieved.', sources.compromise),
  historical('austria-hungary', 'city', 'budapest', 'A law of 1872 created a single capital for Hungary. On 17 November 1873, Pest, Buda, Óbuda and Margaret Island were united as Budapest.', sources.budapest),

  // Authoritarian rule and the Soviet collapse.
  historical('world-war-one', 'republic', 'weimar-republic', 'Defeat and the November Revolution of 1918 brought down the German Empire. The National Assembly, meeting at Weimar, adopted the republic’s constitution on 31 July 1919; it came into force on 14 August.', sources.weimar),
  historical('hitler', 'weimar-republic', 'reichstag-fire', 'Four weeks after Hitler became chancellor, the Reichstag building burned on 27 February 1933. The government falsely presented the fire as a communist plot, and a decree the next day suspended constitutional rights.', sources.reichstagFire),
  historical('reichstag-fire', 'constitution', 'enabling-act', 'With all 81 communist deputies barred from their seats and SA and SS men stationed in the chamber, the Reichstag passed the Enabling Act on 23 March 1933. Hitler’s government could now make laws without parliament.', sources.enablingAct),
  association('weimar-republic', 'dictatorship', 'enabling-act', 'The Enabling Act let the government issue laws without parliament’s consent, even laws that broke the Weimar constitution. Intimidation and persecution secured its passage.', sources.enablingAct),
  historical('soviet-union', 'reform', 'gorbachev', 'Mikhail Gorbachev became General Secretary of the Soviet Communist Party in March 1985, with an economic and political agenda of perestroika and glasnost.', sources.gorbachev),
  historical('gorbachev', 'censorship', 'glasnost', 'Under glasnost, or “openness”, freedom of expression and information greatly expanded in the late 1980s. The press could report and criticise with new candour, and the government repudiated the legacy of Stalinist rule.', sources.gorbachevReforms),
  historical('gorbachev', 'five-year-plan', 'perestroika', 'Perestroika, or “restructuring”, brought limited free-market mechanisms into the centrally planned economy and the first modest steps to democratise politics, such as some contested elections.', sources.gorbachevReforms),
  historical('glasnost', 'revolution', 'fall-berlin-wall', 'Gorbachev made clear that the Soviet Union would no longer intervene militarily to support communist regimes. As hundreds of thousands protested across East Germany, its government announced the opening of the borders on 9 November 1989, and the Berlin Wall came down.', sources.fallCommunism),
  historical('perestroika', 'nationalism', 'dissolution-ussr', 'Gorbachev’s reforms destabilised Communist control, and the Baltic states and the Caucasus demanded independence. The failed coup of August 1991 sealed the Soviet Union’s fate; Gorbachev resigned on 25 December 1991.', sources.sovietCollapse),
  association('fall-berlin-wall', 'soviet-union', 'dissolution-ussr', 'The end of communist rule in Eastern Europe in 1989 was followed by demands for independence inside the Soviet Union itself, which came apart in December 1991.', sources.sovietCollapse),

  // Canada and the First World War.
  association('empire', 'constitution', 'canada', 'This pair opens the Canadian case study. Confederation on 1 July 1867 rested on the British North America Act, passed by the British Parliament; Indigenous peoples were not represented at the conferences that planned it.', sources.confederation),
  historical('canada', 'world-war-one', 'canada-at-war', 'When Britain went to war on 4 August 1914, Canada, a self-governing Dominion, was legally at war too. Canadians decided the nature and extent of their own war effort.', sources.canadaWar),
  historical('canada', 'war', 'canada-at-war', 'Canada did not control its own foreign affairs in 1914: Britain’s declaration of war on 4 August committed the whole British Empire.', sources.canadaWar),
  historical('canada-at-war', 'technology', 'ypres-1915', 'Canada’s first major battle began on 22 April 1915, when German troops released chlorine gas near Ypres. Canadians held a critical part of the line; more than 6,500 were killed, wounded or captured.', sources.ypres),
  historical('ypres-1915', 'newspaper', 'in-flanders-fields', 'The Canadian doctor John McCrae wrote the poem on 3 May 1915, during the battle. The magazine Punch printed it, without McCrae’s name, on 8 December 1915.', sources.flanders),
  historical('canada-at-war', 'alliance', 'somme-1916', 'From 1 July to 18 November 1916, British Empire and French troops attacked on the Somme; about 1.2 million men were killed or wounded. The Canadian Corps fought in the final three months.', sources.somme),
  historical('world-war-one', 'alliance', 'somme-1916', 'The Somme was chosen for a joint French and British assault. On 1 July 1916 the Newfoundland Regiment, from a Dominion not yet part of Canada, attacked at Beaumont-Hamel: of some 800 men, only 68 answered the next day’s roll call.', sources.beaumontHamel),
  historical('somme-1916', 'reform', 'vimy-ridge', 'The slaughter on the Somme prompted new tactics. After careful rehearsal, the four Canadian divisions captured Vimy Ridge on 9–12 April 1917, at a cost of 10,602 casualties, 3,598 of them killed.', sources.vimy),
  association('canada-at-war', 'nationalism', 'vimy-ridge', 'Vimy became a celebrated symbol of Canadian national pride. Recent historians question how far its reputation rests on nationalist mythmaking.', sources.vimy),
  historical('vimy-ridge', 'state', 'conscription-crisis', 'As losses mounted and volunteering dried up, Robert Borden’s government passed the Military Service Act, law from 29 August 1917. It bitterly divided the country along French–English lines, and many farmers opposed it too.', sources.conscription),
  historical('canada', 'community', 'hockey', 'Stick-and-ball games on ice are centuries old, but the match at Montreal’s Victoria Skating Rink on 3 March 1875, organised by James Creighton, is the first recorded indoor game of ice hockey.', sources.hockey),
  historical('canada', 'city', 'toronto', 'John Graves Simcoe laid out the town of York in 1793 and used it as a capital of Upper Canada. In 1834 it was incorporated as the City of Toronto.', sources.toronto),
  historical('hockey', 'toronto', 'maple-leafs', 'Owner Conn Smythe gave Toronto’s NHL club the name Maple Leafs in 1927. In 1967, Canada’s centennial year, the Leafs won the Stanley Cup.', sources.leafs),

  // The goal. Each route to Mr. Wood joins an IB History teacher with one of Mr. Wood’s interests.
  association('community', 'ideas', 'school', 'A community organised around ideas and learning opens a route to schools. Ask who could attend, and who decided what was taught.'),
  association('school', 'people', 'teacher', 'Every school depends on the people who teach in it. What teachers taught, and to whom, has its own long history.'),
  historical('school', 'league-nations', 'international-school-geneva', 'Officials of the League of Nations and the International Labour Organization, together with local educators, founded the International School of Geneva. It opened on 17 September 1924 with eight students and a rabbit.', sources.ecolint),
  historical('international-school-geneva', 'reform', 'international-baccalaureate', 'Teachers at the International School of Geneva, helped by several other international schools, created the IB Diploma Programme, established in 1968.', sources.ib),
  association('teacher', 'international-baccalaureate', 'ib-history-teacher', 'History is one of the IB Diploma’s subjects. Its teachers guide students through source analysis, essays and a historical investigation of their own.'),
  school('ib-history-teacher', 'napoleon', 'mr-wood', 'Asked to choose one person from history to share a drink with, Mr. Wood picked Napoleon. Add an IB History teacher, and there is Mr. Wood.', sources.woodProfile),
  school('ib-history-teacher', 'hockey', 'mr-wood', 'Besides teaching IB History and supervising extended essays, Mr. Wood is one of St. Robert’s assistant hockey coaches.', sources.department),
  school('ib-history-teacher', 'budapest', 'mr-wood', 'Budapest is on Mr. Wood’s travel bucket list. Pair the city with an IB History teacher to find Mr. Wood.', sources.woodProfile),
];
