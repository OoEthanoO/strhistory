import type { ConnectionsPuzzle } from './types';

// One puzzle a day, in this order. The access service counts positions in this
// list, so add new puzzles at the end and never reorder or remove released ones.
// Every puzzle must have exactly one arrangement that uses all sixteen tiles:
// when a tile also fits another group's label, its own group must be impossible
// to complete without it. Explanations name the trap. Labels are connections to explore,
// not causal claims; each group cites sources for its facts. A soft hyphen
// (\u00AD) marks where a long word may break to fit four tiles across a phone.
export const connectionsPuzzles: ConnectionsPuzzle[] = [
  {
    id: 'crowns',
    groups: [
      {
        level: 1, label: 'Titles of monarchs', items: ['Tsar', 'Kaiser', 'Sultan', 'Shah'],
        explanation: 'Each named a ruler: the Russian tsar, the German or Austrian kaiser, the Ottoman sultan and the shah of Iran. Tsar and kaiser both come from the Roman name Caesar.',
        sources: [{ label: 'Encyclopaedia Britannica · Julius Caesar', url: 'https://www.britannica.com/biography/Julius-Caesar-Roman-ruler' }],
      },
      {
        level: 2, label: 'Royal and imperial palaces', items: ['Versailles', 'Winter Palace', 'Schönbrunn', 'Forbidden City'],
        explanation: 'Versailles was the seat of the French court until October 1789, the Winter Palace in St Petersburg the tsars’ official residence, Schönbrunn the Habsburgs’ summer palace in Vienna, and the Forbidden City in Beijing the home of Ming and Qing emperors.',
        sources: [{ label: 'Château de Versailles · Versailles and the Revolution', url: 'https://en.chateauversailles.fr/discover/history/key-dates/versailles-heart-french-revolution' }, { label: 'UNESCO World Heritage Centre · Palace and Gardens of Schönbrunn', url: 'https://whc.unesco.org/en/list/786' }],
      },
      {
        level: 3, label: 'Monarchs put to death by their opponents', items: ['Charles I', 'Louis XVI', 'Maximilian', 'Nicholas II'],
        explanation: 'Charles I of England (1649) and Louis XVI of France (1793) were executed after trials. Mexican republicans shot the emperor Maximilian in 1867, and Bolsheviks killed Nicholas II and his family in 1918.',
        sources: [{ label: 'Encyclopaedia Britannica · Maximilian', url: 'https://www.britannica.com/biography/Maximilian-archduke-of-Austria-and-emperor-of-Mexico' }, { label: 'Encyclopaedia Britannica · Nicholas II', url: 'https://www.britannica.com/biography/Nicholas-II-tsar-of-Russia' }],
      },
      {
        level: 4, label: 'Last rulers of empires that ended in 1912–1922', items: ['Puyi', 'Wilhelm II', 'Karl I', 'Mehmed VI'],
        explanation: 'Puyi’s abdication in 1912 ended Qing rule in China. Wilhelm II and Karl I lost their thrones in November 1918, though Karl withdrew from government without formally abdicating. The Ottoman sultanate was abolished in 1922. Nicholas II, the last tsar, belongs with the monarchs who were killed.',
        sources: [{ label: 'The World of the Habsburgs · The final days of the Monarchy', url: 'https://www.habsburger.net/en/chapter/final-days-monarchy' }, { label: 'Encyclopaedia Britannica · Mehmed VI', url: 'https://www.britannica.com/biography/Mehmed-VI' }],
      },
    ],
  },
  {
    id: 'risorgimento',
    groups: [
      {
        level: 1, label: 'Leading figures of Italian unification', items: ['Garibaldi', 'Cavour', 'Mazzini', 'Victor Emmanuel II'],
        explanation: 'The republican Mazzini, Piedmont’s prime minister Cavour, the volunteer general Garibaldi and Victor Emmanuel II, who became the first king of Italy in 1861. They often disagreed about how, and under whom, Italy should be united.',
        sources: [{ label: 'Encyclopaedia Britannica · Unification of Italy', url: 'https://www.britannica.com/topic/unification-of-Italy' }, { label: 'Italian Presidency · Cavour and Italian unification', url: 'https://presidenti.quirinale.it/Elementi/54681' }], topic: 'kingdom-italy-1861',
      },
      {
        level: 2, label: 'States of Italy before unification', items: ['Papal States', 'Two Sicilies', 'Tuscany', 'Modena'],
        explanation: 'Before 1859 the peninsula’s main states were the Papal States, the Kingdom of the Two Sicilies, the Grand Duchy of Tuscany, the duchies of Modena and Parma, Piedmont–Sardinia and Austrian-ruled Lombardy–Venetia.',
        sources: [{ label: 'Encyclopaedia Britannica · Unification of Italy', url: 'https://www.britannica.com/topic/unification-of-Italy' }],
      },
      {
        level: 3, label: 'Battles of the Italian wars of unification', items: ['Custoza', 'Novara', 'Calatafimi', 'Volturno'],
        explanation: 'Austria defeated Piedmont at Custoza in 1848 and at Novara in 1849. In 1860 Garibaldi’s volunteers won at Calatafimi in Sicily and on the Volturno river north of Naples.',
        sources: [{ label: 'Encyclopaedia Britannica · Unification of Italy', url: 'https://www.britannica.com/topic/unification-of-Italy' }, { label: 'Encyclopaedia Britannica · Giuseppe Garibaldi', url: 'https://www.britannica.com/biography/Giuseppe-Garibaldi' }],
      },
      {
        level: 4, label: 'Named after battles', items: ['Magenta', 'Blenheim', 'Marathon', 'Waterloo'],
        explanation: 'A dye was named magenta after the French and Piedmontese victory of 1859, Blenheim Palace after the battle of 1704, the marathon race after the legend of a runner from Marathon (490 BCE), and London’s Waterloo Bridge after 1815. Magenta was also a battle of unification: that is the trap.',
        sources: [{ label: 'Royal Society of Chemistry · The battle for magenta', url: 'https://edu.rsc.org/feature/the-battle-for-magenta/2020242.article' }, { label: 'London Museum · Waterloo Bridge', url: 'https://www.londonmuseum.org.uk/collections/london-stories/waterloo-bridge/' }],
      },
    ],
  },
  {
    id: 'canada-western-front',
    groups: [
      {
        level: 1, label: 'Western Front battles fought by Canadians', items: ['Ypres', 'Somme', 'Vimy Ridge', 'Passchen\u00ADdaele'],
        explanation: 'Canadian troops held the line during the gas attacks at Ypres in April 1915, fought at Courcelette on the Somme in 1916, took Vimy Ridge in April 1917 and captured Passchendaele that November.',
        sources: [{ label: 'Veterans Affairs Canada · First World War', url: 'https://www.veterans.gc.ca/en/remembrance/military-history/first-world-war' }, { label: 'Veterans Affairs Canada · Battle of the Somme', url: 'https://www.veterans.gc.ca/en/remembrance/military-history/first-world-war/battle-somme' }], topic: 'canada-vimy-ridge-1917',
      },
      {
        level: 2, label: 'New technology on the Western Front', items: ['Chlorine gas', 'Tank', 'Lewis gun', 'Box respirator'],
        explanation: 'Chlorine was released against Allied lines at Ypres in 1915; tanks first went into action at Flers–Courcelette on 15 September 1916; the portable Lewis gun gave attacking infantry firepower; box respirators, developed in 1916, replaced cloth gas hoods.',
        sources: [{ label: 'Veterans Affairs Canada · Battle of the Somme', url: 'https://www.veterans.gc.ca/en/remembrance/military-history/first-world-war/battle-somme' }, { label: 'Canadian War Museum · Small Box Respirator', url: 'https://www.warmuseum.ca/firstworldwar/objects-and-photos/equipment-and-vehicles/uniforms-and-personal-gear/small-box-respirator/' }], topic: 'canada-ypres-1915',
      },
      {
        level: 3, label: 'The language of trench warfare', items: ['Salient', 'Over the top', 'No man’s land', 'Attrition'],
        explanation: 'A salient is a bulge in the front line, exposed on three sides, as at Ypres. Soldiers went over the top when they left their trench to attack across no man’s land. Attrition meant wearing the enemy down, as at Verdun and the Somme.',
        sources: [{ label: 'Veterans Affairs Canada · 2nd Battle of Ypres', url: 'https://www.veterans.gc.ca/en/remembrance/military-history/first-world-war/2nd-battle-ypres' }, { label: 'National Army Museum · 1916: Year of attrition', url: 'https://www.nam.ac.uk/explore/1916-year-attrition' }], topic: 'canada-somme-1916',
      },
      {
        level: 4, label: 'Canada’s home front in 1917', items: ['Conscrip\u00ADtion', 'Income tax', 'Halifax Explosion', 'Wartime Elections Act'],
        explanation: 'In 1917 the Military Service Act brought conscription and the Income War Tax Act the first federal income tax. The Wartime Elections Act gave the vote to some soldiers’ female relatives and took it from many naturalised immigrants born in enemy countries. On 6 December a munitions ship exploded in Halifax harbour.',
        sources: [{ label: 'The Canadian Encyclopedia · Income Tax in Canada', url: 'https://thecanadianencyclopedia.ca/en/article/income-tax' }, { label: 'The Canadian Encyclopedia · Wartime Elections Act', url: 'https://thecanadianencyclopedia.ca/en/article/wartime-elections-act' }],
      },
    ],
  },
  {
    id: 'soviet-names',
    groups: [
      {
        level: 1, label: 'Led the Soviet Communist Party after Stalin', items: ['Khrushchev', 'Brezhnev', 'Andropov', 'Chernenko'],
        explanation: 'Khrushchev (1953–64), Brezhnev (1964–82), Andropov (1982–84) and Chernenko (1984–85) led the party before Gorbachev. The last three died in office within three years of one another.',
        sources: [{ label: 'Encyclopaedia Britannica · Leonid Brezhnev', url: 'https://www.britannica.com/biography/Leonid-Ilich-Brezhnev' }, { label: 'Encyclopaedia Britannica · Konstantin Chernenko', url: 'https://www.britannica.com/biography/Konstantin-Chernenko' }],
      },
      {
        level: 2, label: 'Heads of the Soviet secret police', items: ['Dzerzhin\u00ADsky', 'Yagoda', 'Yezhov', 'Beria'],
        explanation: 'Dzerzhinsky founded the Cheka in 1917. Yagoda and Yezhov ran the NKVD during the purges of the 1930s and were themselves shot. Beria took over in 1938 and was executed after Stalin’s death. Andropov ran the KGB from 1967 to 1982, but he belongs with the party leaders.',
        sources: [{ label: 'Seventeen Moments in Soviet History · Personages', url: 'https://soviethistory.msu.edu/personages/' }, { label: 'Seventeen Moments in Soviet History · The Great Terror', url: 'https://soviethistory.msu.edu/1936/great-terror/' }], topic: 'stalin-ussr',
      },
      {
        level: 3, label: 'Showpieces of Stalin’s industrial drive', items: ['Magnito\u00ADgorsk', 'Dnepro\u00ADstroi', 'White Sea Canal', 'Turksib'],
        explanation: 'The steel city of Magnitogorsk, the Dnieper dam and power station, the Turkestan–Siberian railway and the White Sea–Baltic Canal, dug largely by Gulag prisoners, were celebrated as achievements of the Five-Year Plans begun in 1928.',
        sources: [{ label: 'Seventeen Moments in Soviet History · Glossary', url: 'https://soviethistory.msu.edu/glossary/' }, { label: 'Seventeen Moments in Soviet History · Making Central Asia Soviet', url: 'https://soviethistory.msu.edu/1929/making-central-asia-soviet/' }], topic: 'stalin-ussr',
      },
      {
        level: 4, label: 'Revolutionary pseudonyms', items: ['Lenin', 'Stalin', 'Trotsky', 'Molotov'],
        explanation: 'All four were adopted names: Vladimir Ulyanov became Lenin, Ioseb Jughashvili became Stalin (from the Russian for steel), Lev Bronstein became Trotsky, and Vyacheslav Skryabin became Molotov (from the Russian for hammer). Lenin and Stalin led the party too, but before the other group’s four.',
        sources: [{ label: 'Seventeen Moments in Soviet History · Personages', url: 'https://soviethistory.msu.edu/personages/' }, { label: 'Britannica Kids · Vyacheslav Molotov', url: 'https://kids.britannica.com/students/article/Vyacheslav-Mikhaylovich-Molotov/275892' }], topic: 'russian-revolutions',
      },
    ],
  },
  {
    id: 'paris-1789',
    groups: [
      {
        level: 1, label: 'Revolutionary assemblies', items: ['Estates General', 'National Assembly', 'Legisla\u00ADtive Assembly', 'National Convention'],
        explanation: 'The Estates General met at Versailles in May 1789, and the Third Estate’s deputies declared themselves the National Assembly in June. The Legislative Assembly sat from 1791; the National Convention, elected in 1792, abolished the monarchy.',
        sources: [{ label: 'Château de Versailles · Tennis Court Oath', url: 'https://en.chateauversailles.fr/discover/history/key-dates/jeu-paume-oath-1789' }, { label: 'Assemblée nationale · The Convention and the end of the monarchy, 1792', url: 'https://www.assemblee-nationale.fr/dyn/histoire-et-patrimoine/revolution-francaise/la-convention-nationale-et-la-fin-de-la-royaute' }], topic: 'tennis-court-oath-1789',
      },
      {
        level: 2, label: 'Paris sites of revolutionary events', items: ['Bastille', 'Tuileries', 'Champ de Mars', 'Hôtel de Ville'],
        explanation: 'Crowds took the Bastille on 14 July 1789 and stormed the Tuileries palace on 10 August 1792. The Champ de Mars saw the Festival of the Federation in 1790 and the shooting of petitioners in 1791. Robespierre was arrested at the Hôtel de Ville in July 1794.',
        sources: [{ label: 'Élysée · 14 July 1789', url: 'https://www.elysee.fr/en/french-presidency/bastille-day-14-july' }, { label: 'City of Paris, Parcours Révolution · The Hôtel de Ville', url: 'https://parcoursrevolution.paris.fr/en/points-of-interest/47-the-hotel-de-ville-headquarters-of-the-parisian-revolution' }], topic: 'storming-bastille-1789',
      },
      {
        level: 3, label: 'Women in the Revolution', items: ['Olympe de Gouges', 'Madame Roland', 'Charlotte Corday', 'Pauline Léon'],
        explanation: 'Olympe de Gouges wrote the Declaration of the Rights of Woman (1791). Madame Roland’s salon was a Girondin meeting place. Charlotte Corday killed Marat in 1793, the year Pauline Léon co-founded the Society of Revolutionary Republican Women. De Gouges, Roland and Corday were guillotined.',
        sources: [{ label: 'Liberty, Equality, Fraternity (George Mason University and CUNY) · Women and the Revolution', url: 'https://revolution.chnm.org/exhibits/show/liberty--equality--fraternity/women-and-the-revolution' }, { label: 'City of Paris, Parcours Révolution · Pauline Léon', url: 'https://parcoursrevolution.paris.fr/en/historical-figures/64-leon-pauline' }],
      },
      {
        level: 4, label: 'Laws and declarations', items: ['August Decrees', 'Rights of Man', 'Civil Constitu\u00ADtion', 'Law of Suspects'],
        explanation: 'The August Decrees (1789) abolished feudal privileges, and the Declaration of the Rights of Man and of the Citizen followed that month. The Civil Constitution of the Clergy (1790) divided Catholics. The Law of Suspects (1793) widened arrests during the Terror.',
        sources: [{ label: 'Liberty, Equality, Fraternity (George Mason University and CUNY) · Paris and the Politics of Rebellion', url: 'https://revolution.chnm.org/exhibits/show/liberty--equality--fraternity/paris-and-the-politics-of-rebe' }, { label: 'Assemblée nationale · The Terror, 1793–94', url: 'https://www.assemblee-nationale.fr/dyn/histoire-et-patrimoine/revolution-francaise/la-terreur' }],
      },
    ],
  },
  {
    id: 'prefixes',
    groups: [
      {
        level: 1, label: 'Great ___', items: ['Fear', 'Leap Forward', 'Terror', 'Depression'],
        explanation: 'The Great Fear swept rural France in 1789; the Great Leap Forward (1958–62) caused a catastrophic famine in China; the Great Terror was Stalin’s purge of 1936–38; the Great Depression followed the crash of 1929.',
        sources: [{ label: 'Liberty, Equality, Fraternity (George Mason University and CUNY) · Social Causes of Revolution', url: 'https://revolution.chnm.org/exhibits/show/liberty--equality--fraternity/social-causes-of-revolution' }, { label: 'Seventeen Moments in Soviet History · The Great Terror', url: 'https://soviethistory.msu.edu/1936/great-terror/' }],
      },
      {
        level: 2, label: 'Iron ___', items: ['Curtain', 'Chancellor', 'Lady', 'Duke'],
        explanation: 'Churchill’s “iron curtain” speech (1946) described a divided Europe. Bismarck was the Iron Chancellor, Margaret Thatcher the Iron Lady and the Duke of Wellington the Iron Duke.',
        sources: [{ label: 'Margaret Thatcher Foundation · Speech to Finchley Conservatives, 1976', url: 'https://www.margaretthatcher.org/document/102947' }, { label: 'International Churchill Society · The Sinews of Peace (Iron Curtain speech)', url: 'https://winstonchurchill.org/resources/speeches/1946-1963-elder-statesman/the-sinews-of-peace/' }],
      },
      {
        level: 3, label: 'Black ___', items: ['Death', 'Hand', 'Tuesday', 'Shirts'],
        explanation: 'The Black Death killed perhaps a third or more of Europe’s people in 1347–51. The Black Hand was the Serbian secret society linked to the Sarajevo assassination. Black Tuesday, 29 October 1929, was one of the worst days of the Wall Street crash. Blackshirts were Mussolini’s paramilitaries.',
        sources: [{ label: '1914-1918-online (International Encyclopedia of the First World War) · Black Hand', url: 'https://encyclopedia.1914-1918-online.net/article/black-hand/' }, { label: 'Federal Reserve History · Stock Market Crash of 1929', url: 'https://www.federalreservehistory.org/essays/stock-market-crash-of-1929' }],
      },
      {
        level: 4, label: 'Long ___', items: ['March', 'Telegram', 'Parliament', 'Knives'],
        explanation: 'China’s communists made the Long March in 1934–35; Kennan’s Long Telegram (1946) shaped the policy of containment; England’s Long Parliament first met in 1640; Hitler purged the SA in the Night of the Long Knives (1934). The Long Depression of 1873–96 is a trap: Depression belongs with Great.',
        sources: [{ label: 'Office of the Historian · George Kennan and Containment', url: 'https://history.state.gov/departmenthistory/short-history/kennan' }, { label: 'US Holocaust Memorial Museum · Röhm Purge', url: 'https://encyclopedia.ushmm.org/content/en/article/roehm-purge' }],
      },
    ],
  },
  {
    id: 'dictators-compared',
    groups: [
      {
        level: 1, label: 'Titles meaning “leader”', items: ['Duce', 'Führer', 'Caudillo', 'Vozhd'],
        explanation: 'Mussolini was il Duce, Hitler der Führer and Franco el Caudillo; Soviet propaganda hailed Stalin as the vozhd. Each word means leader.',
        sources: [{ label: 'Encyclopaedia Britannica · Francisco Franco', url: 'https://www.britannica.com/biography/Francisco-Franco' }, { label: 'Hoover Institution · The Speech That Shook the World', url: 'https://www.hoover.org/research/speech-shook-world' }],
      },
      {
        level: 2, label: 'Birthplaces of dictators', items: ['Braunau', 'Gori', 'Predappio', 'Shaoshan'],
        explanation: 'Hitler was born in Braunau am Inn, Austria (1889), Stalin in Gori, Georgia (1878), Mussolini in Predappio, Romagna (1883), and Mao in Shaoshan, Hunan (1893).',
        sources: [{ label: 'US Holocaust Memorial Museum · Benito Mussolini', url: 'https://encyclopedia.ushmm.org/content/en/article/benito-mussolini-1' }, { label: 'Encyclopaedia Britannica · Joseph Stalin', url: 'https://www.britannica.com/biography/Joseph-Stalin' }],
      },
      {
        level: 3, label: 'Secret police forces', items: ['Gestapo', 'OVRA', 'NKVD', 'Stasi'],
        explanation: 'The Gestapo in Nazi Germany, OVRA in Fascist Italy, the NKVD in Stalin’s Soviet Union and the Stasi in communist East Germany watched, arrested and terrorised opponents.',
        sources: [{ label: 'Treccani · OVRA', url: 'https://www.treccani.it/enciclopedia/ovra/' }, { label: 'US Holocaust Memorial Museum · The Gestapo: Overview', url: 'https://encyclopedia.ushmm.org/content/en/article/gestapo' }],
      },
      {
        level: 4, label: 'Youth movements of dictatorships', items: ['Hitler Youth', 'Balilla', 'Komsomol', 'Red Guards'],
        explanation: 'The Hitler Youth, Italy’s Opera Nazionale Balilla and the Soviet Komsomol organised young people for the regime. In 1966 Mao mobilised students as Red Guards against his rivals in the party.',
        sources: [{ label: 'Treccani · Opera nazionale balilla', url: 'https://www.treccani.it/enciclopedia/opera-nazionale-balilla_(Dizionario-di-Storia)/' }, { label: 'Columbia University, Asia for Educators · Reading Gao Yuan’s Born Red', url: 'https://afe.easia.columbia.edu/special/china_1950_born_red.htm' }], topic: 'mao-china',
      },
    ],
  },
  {
    id: 'reich-1871',
    groups: [
      {
        level: 1, label: 'Prussian leaders of German unification', items: ['Bismarck', 'Moltke', 'Roon', 'Wilhelm I'],
        explanation: 'King Wilhelm I made Bismarck minister-president in 1862. Roon, as war minister, reorganised the army that Moltke, as chief of the general staff, led to victory. Wilhelm was proclaimed German emperor in 1871.',
        sources: [{ label: 'Encyclopaedia Britannica · Albrecht von Roon', url: 'https://www.britannica.com/biography/Albrecht-Theodor-Emil-Graf-von-Roon' }, { label: 'Deutsches Historisches Museum · Otto von Bismarck', url: 'https://www.dhm.de/lemo/biografie/otto-bismarck' }], topic: 'german-empire-1871',
      },
      {
        level: 2, label: 'Battles of the wars of unification', items: ['Düppel', 'Königgrätz', 'Gravelotte', 'Sedan'],
        explanation: 'Prussian troops stormed the Danish positions at Düppel (1864) and defeated Austria at Königgrätz (1866). Prussian-led German armies beat the French at Gravelotte and Sedan (1870), where Napoleon III was captured.',
        sources: [{ label: 'Danish Nature Agency · History of Dybbøl Banke', url: 'https://eng.naturstyrelsen.dk/experience-nature/explore-denmark-s-nature-with-our-guides/dybboel-heights/history' }, { label: 'Encyclopaedia Britannica · Franco-German War', url: 'https://www.britannica.com/event/Franco-German-War' }],
      },
      {
        level: 3, label: 'Southern states that joined the empire in 1870–71', items: ['Bavaria', 'Württem\u00ADberg', 'Baden', 'Hesse'],
        explanation: 'These states stayed outside the Prussian-led North German Confederation of 1867, although Hesse’s lands north of the Main belonged to it. During the war with France they agreed treaties to join the new empire.',
        sources: [{ label: 'Deutsches Historisches Museum · German unification, 1871', url: 'https://www.dhm.de/lemo/kapitel/kaiserreich/reich/reichsgruendung' }, { label: 'Encyclopaedia Britannica · North German Confederation', url: 'https://www.britannica.com/topic/North-German-Confederation' }],
      },
      {
        level: 4, label: 'Famous telegrams', items: ['Ems', 'Kruger', 'Zimmermann', 'Long'],
        explanation: 'Bismarck’s edited Ems telegram provoked France into war in 1870. Wilhelm II’s Kruger telegram (1896) angered Britain. The Zimmermann telegram (1917) offered Mexico an alliance against the United States. Kennan’s Long Telegram (1946) shaped the policy of containment.',
        sources: [{ label: 'Encyclopaedia Britannica · Kruger telegram', url: 'https://www.britannica.com/event/Kruger-telegram' }, { label: 'US National Archives · The Zimmermann Telegram', url: 'https://www.archives.gov/education/lessons/zimmermann' }],
      },
    ],
  },
  {
    id: 'cold-war',
    groups: [
      {
        level: 1, label: 'Divided during the Cold War', items: ['Germany', 'Berlin', 'Korea', 'Vietnam'],
        explanation: 'Germany and Berlin were split between east and west after 1945; Korea was divided at the 38th parallel in 1945 and Vietnam at the 17th parallel in 1954. Vietnam was formally reunified in 1976 and Germany in 1990; Korea remains divided.',
        sources: [{ label: 'Office of the Historian · Korean War and Japan’s Recovery', url: 'https://history.state.gov/milestones/1945-1952/korean-war' }, { label: 'Office of the Historian · Vietnam (Guide to Country Recognition)', url: 'https://history.state.gov/countries/vietnam' }], topic: 'origins-cold-war',
      },
      {
        level: 2, label: 'Arms control agreements', items: ['SALT', 'ABM', 'INF', 'START'],
        explanation: 'The first Strategic Arms Limitation Talks produced the Anti-Ballistic Missile Treaty and an interim agreement on missiles in 1972; the Intermediate-Range Nuclear Forces Treaty (1987) and the Strategic Arms Reduction Treaty (1991) followed. Each limited or cut US and Soviet nuclear forces or missile defences.',
        sources: [{ label: 'Office of the Historian · Strategic Arms Limitations Talks/Treaty (SALT) I and II', url: 'https://history.state.gov/milestones/1969-1976/salt' }, { label: 'Office of the Historian · U.S.-Soviet Relations, 1981–1991', url: 'https://history.state.gov/milestones/1981-1988/u.s.-soviet-relations' }],
      },
      {
        level: 3, label: 'Cambridge spies', items: ['Philby', 'Burgess', 'Maclean', 'Blunt'],
        explanation: 'Kim Philby, Guy Burgess, Donald Maclean and Anthony Blunt, Cambridge graduates recruited by Soviet intelligence in the 1930s, passed British secrets to Moscow. John Cairncross is usually named as the fifth.',
        sources: [{ label: 'The National Archives · Confessions from the Cambridge Five: a file release from MI5', url: 'https://www.nationalarchives.gov.uk/explore-the-collection/the-collection-blog/confessions-from-the-cambridge-five/' }],
      },
      {
        level: 4, label: 'Doctrines', items: ['Truman', 'Monroe', 'Brezhnev', 'Sinatra'],
        explanation: 'The Monroe Doctrine (1823) warned European powers off the Americas; the Truman Doctrine (1947) promised support against communist pressure; the Brezhnev Doctrine (1968) justified intervening in socialist states. In October 1989 the Soviet spokesman Gennadi Gerasimov joked that a Sinatra Doctrine now let Eastern European states go their own way.',
        sources: [{ label: 'NATO · Poland and NATO', url: 'https://nato.int/en/about-us/nato-history/history-by-theme/my-country-and-nato/poland-and-nato' }, { label: 'Office of the Historian · Monroe Doctrine, 1823', url: 'https://history.state.gov/milestones/1801-1829/monroe' }],
      },
    ],
  },
  {
    id: 'canada-autonomy',
    groups: [
      {
        level: 1, label: 'Canadian prime ministers', items: ['Laurier', 'Borden', 'Meighen', 'King'],
        explanation: 'Wilfrid Laurier led Canada from 1896 to 1911 and Robert Borden through the First World War. Arthur Meighen followed in 1920, and William Lyon Mackenzie King governed for most of 1921–48.',
        sources: [{ label: 'The Canadian Encyclopedia · Prime Ministers of Canada', url: 'https://thecanadianencyclopedia.ca/en/article/prime-ministers-of-canada' }], topic: 'canada-declares-war-1914',
      },
      {
        level: 2, label: 'Steps to Canadian autonomy', items: ['Imperial War Cabinet', 'Treaty of Versailles', 'Halibut Treaty', 'Statute of West\u00ADminster'],
        explanation: 'Borden sat in the Imperial War Cabinet from 1917. Canada signed the Treaty of Versailles, though under the British Empire’s heading, and joined the League of Nations in its own right. It negotiated and signed the Halibut Treaty (1923) with the United States without a British signature, and the Statute of Westminster (1931) confirmed its legislative independence.',
        sources: [{ label: 'The Canadian Encyclopedia · Halibut Treaty', url: 'https://thecanadianencyclopedia.ca/en/article/halibut-treaty' }, { label: 'Dictionary of Canadian Biography · Borden, Sir Robert Laird', url: 'https://www.biographi.ca/en/bio/borden_robert_laird_16E.html' }],
      },
      {
        level: 3, label: 'Home front places, 1914–1919', items: ['Valcartier', 'Halifax', 'Quebec City', 'Winnipeg'],
        explanation: 'The first contingent trained at Valcartier camp in 1914. A munitions ship exploded in Halifax harbour in 1917. Soldiers fired on anti-conscription rioters in Quebec City in 1918, and the Winnipeg General Strike followed in 1919. Camp Borden, opened in 1916, was a home-front place too, but the prime ministers need Borden.',
        sources: [{ label: 'The Canadian Encyclopedia · First World War (WWI)', url: 'https://thecanadianencyclopedia.ca/en/article/first-world-war-wwi' }, { label: 'The Canadian Encyclopedia · Winnipeg General Strike of 1919', url: 'https://thecanadianencyclopedia.ca/en/article/winnipeg-general-strike' }],
      },
      {
        level: 4, label: 'Remembrance', items: ['Poppy', 'Vimy Memorial', 'Last Post', 'Two minutes’ silence'],
        explanation: 'Inspired by John McCrae’s poem, the poppy became Canada’s symbol of remembrance in 1921, and the Vimy Memorial was unveiled in 1936. The bugle call the Last Post and a two-minute silence are part of Remembrance Day ceremonies.',
        sources: [{ label: 'Canadian War Museum · The Poppy', url: 'https://www.warmuseum.ca/firstworldwar/history/after-the-war/remembrance/the-poppy/' }, { label: 'Canadian War Museum · Vimy Memorial', url: 'https://www.warmuseum.ca/firstworldwar/history/after-the-war/remembrance/vimy-memorial/' }], topic: 'canada-ypres-1915',
      },
    ],
  },
  {
    id: 'revolutionary-france',
    groups: [
      {
        level: 1, label: 'Clubs and factions of the Revolution', items: ['Jacobins', 'Girondins', 'Cordeliers', 'Feuillants'],
        explanation: 'The Jacobin, Cordeliers and Feuillant clubs were named after the former religious houses where they met. The Girondins took their name from the Gironde department, home to several of their deputies.',
        sources: [{ label: 'Liberty, Equality, Fraternity (George Mason University and CUNY) · Jacobin Club', url: 'https://revolution.chnm.org/d/1094' }, { label: 'Liberty, Equality, Fraternity (George Mason University and CUNY) · Girondin', url: 'https://revolution.chnm.org/d/1091' }],
      },
      {
        level: 2, label: 'Guillotined in 1793–94', items: ['Marie Antoinette', 'Danton', 'Lavoisier', 'Robes\u00ADpierre'],
        explanation: 'Marie Antoinette was executed in October 1793, Danton in April 1794, the chemist Antoine Lavoisier in May 1794 as a former tax farmer, and Robespierre on 28 July 1794, the day after his fall. Leading Girondins were guillotined too, in October 1793, but only the Girondins can complete the clubs and factions.',
        sources: [{ label: 'Musée Carnavalet · La Révolution française à Paris (education dossier, PDF, French)', url: 'https://www.carnavalet.paris.fr/sites/default/files/2022-08/mp_dossier_pedagogique_la_revolution_francaise_a_paris.pdf' }, { label: 'Science History Institute · Antoine-Laurent Lavoisier', url: 'https://www.sciencehistory.org/education/scientific-biographies/antoine-laurent-lavoisier/' }],
      },
      {
        level: 3, label: 'Months of the Republican calendar', items: ['Brumaire', 'Thermidor', 'Germinal', 'Floréal'],
        explanation: 'The calendar introduced in 1793 named its months after the seasons: Brumaire (mist), Thermidor (heat), Germinal (germination) and Floréal (flowers). Events are often known by these dates, such as the coup of 18 Brumaire.',
        sources: [{ label: 'Liberty, Equality, Fraternity (George Mason University and CUNY) · French Revolutionary Calendar', url: 'https://revolution.chnm.org/d/1090' }, { label: 'Fondation Napoléon · 18 Brumaire: the context and course of a coup d’État', url: 'https://www.napoleon.org/en/history-of-the-two-empires/articles/18-brumaire-the-context-and-course-of-a-coup-detat/' }],
      },
      {
        level: 4, label: 'Served the Revolution, then Napoleon', items: ['Sieyès', 'Talleyrand', 'Fouché', 'Carnot'],
        explanation: 'Sieyès, author of What Is the Third Estate?, helped plan the coup of 1799. Talleyrand became Napoleon’s foreign minister. Fouché, who had voted for Louis XVI’s death, ran his police. Carnot, the Committee of Public Safety’s organiser of the armies, served briefly as his minister of war.',
        sources: [{ label: 'Fondation Napoléon · Carnot, ‘The Great’, Lazare-Nicolas-Marguerite', url: 'https://www.napoleon.org/en/history-of-the-two-empires/biographies/carnot-the-great-lazare-nicolas-marguerite/' }, { label: 'Fondation Napoléon · 18 Brumaire: the context and course of a coup d’État', url: 'https://www.napoleon.org/en/history-of-the-two-empires/articles/18-brumaire-the-context-and-course-of-a-coup-detat/' }],
      },
    ],
  },
  {
    id: 'operations-and-gods',
    groups: [
      {
        level: 1, label: 'D-Day beaches', items: ['Omaha', 'Utah', 'Gold', 'Sword'],
        explanation: 'American troops landed at Utah and Omaha and British troops at Gold and Sword on 6 June 1944. Canadians landed at the fifth beach, Juno.',
        sources: [{ label: 'National Army Museum · D-Day', url: 'https://www.nam.ac.uk/explore/d-day' }],
      },
      {
        level: 2, label: 'Second World War operations', items: ['Overlord', 'Sea Lion', 'Dynamo', 'Torch'],
        explanation: 'Overlord was the Allied invasion of Normandy (1944), Sea Lion Germany’s planned invasion of Britain (1940), Dynamo the evacuation from Dunkirk (1940) and Torch the Allied landings in French North Africa (1942).',
        sources: [{ label: 'Imperial War Museums · 8 Facts You Need To Know About The Battle of Britain', url: 'https://www.iwm.org.uk/history/second-world-war/battle-of-britain/things-you-need-to-know' }, { label: 'National Army Museum · The struggle for North Africa, 1940–43', url: 'https://www.nam.ac.uk/explore/struggle-north-africa-1940-43' }],
      },
      {
        level: 3, label: 'Leaders in the Third Crusade', items: ['Richard I', 'Philip II', 'Saladin', 'Barbarossa'],
        explanation: 'Richard I of England, Philip II of France and the emperor Frederick I “Barbarossa”, who drowned on the way in 1190, led the crusade of 1189–92 against Saladin, sultan of Egypt and Syria. Germany’s 1941 invasion of the Soviet Union was named after Barbarossa.',
        sources: [{ label: 'Encyclopedia.com (Encyclopedia of Islam and the Muslim World and other reference works) · Crusades', url: 'https://www.encyclopedia.com/history/modern-europe/wars-and-battles/crusades' }, { label: 'Deutsches Historisches Museum · Myths of the Nations: Germany', url: 'https://www.dhm.de/archiv/ausstellungen/mythen/english/deutsch.html' }],
      },
      {
        level: 4, label: 'Named after Roman gods', items: ['Juno', 'Neptune', 'Mercury', 'Jupiter'],
        explanation: 'Juno Beach; Operation Neptune, the naval assault on D-Day; Operation Mercury, Germany’s airborne attack on Crete in 1941; and the Jupiter missiles withdrawn from Turkey after the Cuban Missile Crisis. Neptune and Mercury, like Juno and Jupiter, also named operations, but only these four can complete this group.',
        sources: [{ label: 'Imperial War Museums · What Was the Battle of Crete?', url: 'https://www.iwm.org.uk/history/second-world-war/north-africa-campaign/what-was-the-battle-of-crete' }, { label: 'Office of the Historian · The Cuban Missile Crisis, October 1962', url: 'https://history.state.gov/milestones/1961-1968/cuban-missile-crisis' }],
      },
    ],
  },
  {
    id: 'nazi-dictatorship',
    groups: [
      {
        level: 1, label: 'Nazi leaders', items: ['Hitler', 'Göring', 'Goebbels', 'Himmler'],
        explanation: 'Hitler became chancellor in January 1933. Göring created the Gestapo in Prussia and later led the air force; Goebbels ran propaganda; Himmler led the SS and, from 1936, all German police.',
        sources: [{ label: 'US Holocaust Memorial Museum · Hermann Göring', url: 'https://encyclopedia.ushmm.org/content/en/article/hermann-goering' }, { label: 'US Holocaust Memorial Museum · Heinrich Himmler', url: 'https://encyclopedia.ushmm.org/content/en/article/heinrich-himmler' }], topic: 'enabling-act-1933',
      },
      {
        level: 2, label: 'Steps to dictatorship, 1933–34', items: ['Reichstag Fire', 'Enabling Act', 'Unions banned', 'Army oath'],
        explanation: 'After the Reichstag fire in February 1933 an emergency decree suspended civil rights. The Enabling Act of March 1933 let the government make laws without the Reichstag. Trade unions were broken up from 2 May 1933, and after Hindenburg’s death in August 1934 soldiers swore an oath to Hitler personally.',
        sources: [{ label: 'US Holocaust Memorial Museum · Foundations of the Nazi State', url: 'https://encyclopedia.ushmm.org/content/en/article/foundations-of-the-nazi-state' }, { label: 'Deutsches Historisches Museum · Die Zerschlagung der Gewerkschaften 1933', url: 'https://www.dhm.de/lemo/kapitel/ns-regime/etablierung-der-ns-herrschaft/zerschlagung-der-gewerkschaften' }], topic: 'enabling-act-1933',
      },
      {
        level: 3, label: 'Nazi organisations', items: ['SA', 'SS', 'Gestapo', 'Hitler Youth'],
        explanation: 'The SA stormtroopers terrorised opponents; the SS grew from Hitler’s bodyguard into a vast police and racial apparatus; the Gestapo was the secret state police; the Hitler Youth became the only legal youth organisation in 1936.',
        sources: [{ label: 'US Holocaust Memorial Museum · Hitler Youth', url: 'https://encyclopedia.ushmm.org/content/en/article/hitler-youth-2' }, { label: 'US Holocaust Memorial Museum · The SS', url: 'https://encyclopedia.ushmm.org/content/en/article/ss' }],
      },
      {
        level: 4, label: 'Germans who opposed the regime', items: ['White Rose', 'Edelweiss Pirates', 'Confessing Church', 'Kreisau Circle'],
        explanation: 'White Rose students distributed leaflets in Munich until their arrest in 1943. Edelweiss Pirates were youths in Cologne and other Rhineland cities who rejected the Hitler Youth. The Confessing Church resisted Nazi control of Protestant churches, and the Kreisau Circle planned for a Germany after Hitler.',
        sources: [{ label: 'German Resistance Memorial Center · The Kreisau Circle', url: 'https://www.gdw-berlin.de/en/recess/topics/12-the-kreisau-circle' }, { label: 'German Resistance Memorial Center · Resistance by Young People', url: 'https://www.gdw-berlin.de/en/recess/topics/13-resistance-by-young-people' }],
      },
    ],
  },
  {
    id: 'revolutions-1848',
    groups: [
      {
        level: 1, label: 'Cities that rose in 1848', items: ['Palermo', 'Paris', 'Vienna', 'Milan'],
        explanation: 'The revolutions of 1848 began in Palermo in January and spread to Paris in February, then to Vienna and to Milan, whose Five Days drove out the Austrian garrison, in March.',
        sources: [{ label: 'Ohio State University, Origins · March 1848: The German Revolutions', url: 'https://origins.osu.edu/read/march-1848-german-revolutions' }, { label: 'Treccani · Rivoluzioni del 1848 (Italian)', url: 'https://www.treccani.it/enciclopedia/rivoluzioni-del-1848_(Dizionario-di-Storia)/' }],
      },
      {
        level: 2, label: 'Revolutions named after a month', items: ['February', 'March', 'July', 'October'],
        explanation: 'France had a July Revolution in 1830 and a February Revolution in 1848; the German states had a March Revolution in 1848; Russia had February and October revolutions in 1917, dated by its old Julian calendar.',
        sources: [{ label: 'Château de Versailles · Charles X', url: 'https://en.chateauversailles.fr/discover/history/great-characters/charles-x' }, { label: 'Ohio State University, Origins · March 1848: The German Revolutions', url: 'https://origins.osu.edu/read/march-1848-german-revolutions' }],
      },
      {
        level: 3, label: 'Leaders in 1848–49', items: ['Kossuth', 'Mazzini', 'Lamartine', 'Manin'],
        explanation: 'Lajos Kossuth led Hungary’s revolution; Giuseppe Mazzini was a leader of the Roman Republic of 1849; the poet Alphonse de Lamartine was a leading member of France’s provisional government; Daniele Manin led the Republic of San Marco in Venice.',
        sources: [{ label: 'Treccani · Rivoluzioni del 1848 (Italian)', url: 'https://www.treccani.it/enciclopedia/rivoluzioni-del-1848_(Dizionario-di-Storia)/' }],
      },
      {
        level: 4, label: 'Revolutions named after flowers', items: ['Carnation', 'Rose', 'Tulip', 'Jasmine'],
        explanation: 'Portugal’s Carnation Revolution (1974), Georgia’s Rose Revolution (2003), Kyrgyzstan’s Tulip Revolution (2005) and Tunisia’s 2010–11 uprising, which the foreign press called the Jasmine Revolution, were named after flowers.',
        sources: [{ label: 'Carnegie Endowment for International Peace · Lessons of the Tulip Revolution', url: 'https://carnegieendowment.org/posts/2005/04/lessons-of-the-tulip-revolution' }, { label: 'Nobel Prize · The Nobel Peace Prize 2015: press release', url: 'https://www.nobelprize.org/prizes/peace/2015/press-release/' }],
      },
    ],
  },
  {
    id: 'meiji',
    groups: [
      {
        level: 1, label: 'Wars of Meiji Japan', items: ['Boshin War', 'Satsuma Rebellion', 'Sino-Japanese War', 'Russo-Japanese War'],
        explanation: 'The Boshin War (1868–69) defeated supporters of the shogunate, and the Satsuma Rebellion (1877) was the last great samurai revolt. Victories over China (1894–95) and Russia (1904–05) made Japan an imperial power.',
        sources: [{ label: 'Columbia University, Asia for Educators · The Meiji Restoration and Modernization', url: 'https://afe.easia.columbia.edu/special/japan_1750_meiji.htm' }, { label: 'National Diet Library · Zaibatsu financial conglomerates and their leaders in the Meiji era', url: 'https://www.ndl.go.jp/portrait/e/pickup/010/' }], topic: 'charter-oath-1868',
      },
      {
        level: 2, label: 'Domains that led the Restoration', items: ['Satsuma', 'Chōshū', 'Tosa', 'Hizen'],
        explanation: 'Samurai from these south-western domains, above all Satsuma and Chōshū, overthrew the Tokugawa shogunate in 1867–68, and men from all four dominated the new government.',
        sources: [{ label: 'National Diet Library · Shogunate vassals or other people who supported the Meiji government', url: 'https://www.ndl.go.jp/portrait/e/pickup/012/' }, { label: 'National Diet Library · Chronological Table (Modern Japan in archives)', url: 'https://www.ndl.go.jp/modern/e/utility/chronology.html' }],
      },
      {
        level: 3, label: 'Leaders of the Restoration', items: ['Ōkubo', 'Kido', 'Saigō', 'Iwakura'],
        explanation: 'Ōkubo Toshimichi, Kido Takayoshi and Saigō Takamori are remembered as the three great leaders of the Restoration; the court noble Iwakura Tomomi led the mission to the United States and Europe in 1871–73. Saigō later led the Satsuma Rebellion.',
        sources: [{ label: 'National Diet Library · People of the Meiji Restoration (Autograph manuscripts of well-known people)', url: 'https://www.ndl.go.jp/en/jikihitsu/part2/s1_2' }, { label: 'National Diet Library · 1-7 Iwakura Mission', url: 'https://www.ndl.go.jp/modern/e/cha1/description07.html' }],
      },
      {
        level: 4, label: 'Reforms of 1871–73', items: ['Prefec\u00ADtures', 'Conscrip\u00ADtion', 'Land tax', 'Gregorian calendar'],
        explanation: 'In 1871 the domains were replaced by prefectures. In 1873 the government introduced conscription and a land tax paid in money, and the Gregorian calendar, decreed in late 1872, came into use.',
        sources: [{ label: 'Columbia University, Asia for Educators · The Meiji Restoration and Modernization', url: 'https://afe.easia.columbia.edu/special/japan_1750_meiji.htm' }, { label: 'National Diet Library · Calendar History 2 (The Japanese Calendar)', url: 'https://www.ndl.go.jp/koyomi/e/history/calendar.html' }],
      },
    ],
  },
  {
    id: 'paris-1919',
    groups: [
      {
        level: 1, label: 'The Big Four at the Paris Peace Conference', items: ['Wilson', 'Clemenceau', 'Lloyd George', 'Orlando'],
        explanation: 'The leaders of the United States, France, Britain and Italy dominated the conference’s decisions in 1919. Orlando walked out for a time over Italy’s claim to Fiume.',
        sources: [{ label: 'Deutsches Historisches Museum · Pariser Friedenskonferenz', url: 'https://www.dhm.de/lemo/kapitel/weimarer-republik/aussenpolitik/pariser-friedenskonferenz' }, { label: 'Treccani, Dizionario Biografico degli Italiani · Orlando, Vittorio Emanuele (Italian)', url: 'https://www.treccani.it/enciclopedia/vittorio-emanuele-orlando_(Dizionario-Biografico)/' }],
      },
      {
        level: 2, label: 'Treaties of the 1919–20 peace settlement', items: ['Saint-Germain', 'Neuilly', 'Trianon', 'Sèvres'],
        explanation: 'Each was named after the place near Paris where it was signed: Saint-Germain with Austria (1919), Neuilly with Bulgaria (1919), Trianon with Hungary (1920) and Sèvres with the Ottoman Empire (1920). Turkish resistance led to Sèvres being replaced by the Treaty of Lausanne in 1923.',
        sources: [{ label: 'National Army Museum · First World War timeline', url: 'https://ww1.nam.ac.uk/timeline/' }],
      },
      {
        level: 3, label: 'Taken from Germany by the Treaty of Versailles', items: ['Alsace-Lorraine', 'Eupen-Malmedy', 'Danzig', 'Memel'],
        explanation: 'Alsace-Lorraine returned to France and Eupen-Malmedy went to Belgium. Danzig became a free city under League of Nations protection, and the Memel territory was placed under Allied control until Lithuania seized it in 1923.',
        sources: [{ label: 'Deutsches Historisches Museum · Der Versailler Vertrag', url: 'https://www.dhm.de/lemo/kapitel/weimarer-republik/aussenpolitik/versailles' }, { label: 'Deutsches Historisches Museum · Abtretung Memelland 1920', url: 'https://www.dhm.de/lemo/kapitel/weimarer-republik/aussenpolitik/memel' }],
      },
      {
        level: 4, label: 'League of Nations mandates', items: ['Syria', 'Palestine', 'Iraq', 'Tanganyika'],
        explanation: 'These former Ottoman and German territories were placed under League of Nations mandates: Syria (France), Palestine and Iraq (Britain), and Tanganyika, most of former German East Africa (Britain). Tanganyika was also taken from Germany at Versailles, but only it can complete this group.',
        sources: [{ label: 'United Nations · Origins and Evolution of the Palestine Problem, Part I (1917–1947)', url: 'https://www.un.org/unispal/history2/origins-and-evolution-of-the-palestine-problem/part-i-1917-1947/' }, { label: 'Deutsches Historisches Museum · Die Kolonie Deutsch-Ostafrika', url: 'https://www.dhm.de/lemo/kapitel/kaiserreich/aussenpolitik/ostafrika' }],
      },
    ],
  },
  {
    id: 'eponyms',
    groups: [
      {
        level: 1, label: 'Cities renamed after communist leaders', items: ['Leningrad', 'Stalingrad', 'Ho Chi Minh City', 'Sverdlovsk'],
        explanation: 'Petrograd became Leningrad in 1924 and Tsaritsyn became Stalingrad in 1925 (Volgograd from 1961). Yekaterinburg became Sverdlovsk in 1924, after the Bolshevik leader Yakov Sverdlov, and Saigon was renamed Ho Chi Minh City in 1976.',
        sources: [{ label: 'Encyclopaedia Britannica · Yekaterinburg', url: 'https://www.britannica.com/place/Yekaterinburg' }, { label: 'Museum of Ho Chi Minh City · The city named after Uncle Ho', url: 'https://hcmc-museum.edu.vn/en/luu-tru/3212' }],
      },
      {
        level: 2, label: 'Guns named after their inventors', items: ['Gatling', 'Maxim', 'Lewis', 'Kalash\u00ADnikov'],
        explanation: 'Richard Gatling’s hand-cranked gun (1862), Hiram Maxim’s machine gun (1884), Isaac Lewis’s light machine gun of the First World War and Mikhail Kalashnikov’s AK-47 rifle (1947).',
        sources: [{ label: 'Encyclopaedia Britannica · Small arms: machine guns', url: 'https://www.britannica.com/technology/small-arm/Machine-guns' }, { label: 'Imperial War Museums · The Lewis gun', url: 'https://www.iwm.org.uk/collections/item/object/30034920' }],
      },
      {
        level: 3, label: 'Words that began as surnames', items: ['Guillotine', 'Boycott', 'Quisling', 'Shrapnel'],
        explanation: 'The guillotine is named after Joseph-Ignace Guillotin, who proposed a uniform method of execution in 1789; the boycott after Charles Boycott, a land agent shunned by Irish tenants in 1880; a quisling after Norway’s wartime collaborator Vidkun Quisling; shrapnel after the artillery officer Henry Shrapnel.',
        sources: [{ label: 'Encyclopaedia Britannica · Guillotine', url: 'https://www.britannica.com/topic/guillotine' }, { label: 'Encyclopaedia Britannica · Boycott', url: 'https://www.britannica.com/topic/boycott' }],
      },
      {
        level: 4, label: 'Clothing with military namesakes', items: ['Cardigan', 'Raglan', 'Wellington', 'Balaclava'],
        explanation: 'The Earl of Cardigan, who led the Charge of the Light Brigade, and Lord Raglan, the British commander in the Crimea, gave their titles to a jacket and a sleeve; the Duke of Wellington to a boot; and the Crimean port of Balaclava, scene of an 1854 battle, to a knitted helmet.',
        sources: [{ label: 'Encyclopaedia Britannica · James Thomas Brudenell, 7th Earl of Cardigan', url: 'https://www.britannica.com/biography/James-Thomas-Brudenell-7th-Earl-of-Cardigan' }, { label: 'Encyclopaedia Britannica · FitzRoy Somerset, 1st Baron Raglan', url: 'https://www.britannica.com/biography/FitzRoy-James-Henry-Somerset-1st-Baron-Raglan' }],
      },
    ],
  },
  {
    id: 'mao-fours',
    groups: [
      {
        level: 1, label: 'Targets of the Four Pests campaign', items: ['Rats', 'Flies', 'Mosquitoes', 'Sparrows'],
        explanation: 'In 1958 people across China were mobilised to kill rats, flies, mosquitoes and grain-eating sparrows. Bedbugs later replaced sparrows on the list.',
        sources: [{ label: 'Chineseposters.net · Eliminate the Four Pests (1958)', url: 'https://chineseposters.net/themes/four-pests' }],
      },
      {
        level: 2, label: 'The Gang of Four', items: ['Jiang Qing', 'Zhang Chunqiao', 'Yao Wenyuan', 'Wang Hongwen'],
        explanation: 'Mao’s wife Jiang Qing and three radicals from Shanghai rose to power during the Cultural Revolution. They were arrested a month after Mao’s death in 1976 and tried in 1980–81.',
        sources: [{ label: 'Encyclopaedia Britannica · Gang of Four', url: 'https://www.britannica.com/topic/Gang-of-Four' }], topic: 'mao-china',
      },
      {
        level: 3, label: 'The Four Modernisations', items: ['Agri\u00ADculture', 'Industry', 'Defence', 'Science'],
        explanation: 'Zhou Enlai called for modernising agriculture, industry, national defence and science and technology; Deng Xiaoping made these the goals of reform from 1978.',
        sources: [{ label: 'Encyclopaedia Britannica · Four Modernizations', url: 'https://www.britannica.com/topic/Four-Modernizations' }],
      },
      {
        level: 4, label: 'The Four Olds', items: ['Customs', 'Culture', 'Habits', 'Ideas'],
        explanation: 'In 1966 Red Guards were urged to destroy old customs, old culture, old habits and old ideas, attacking temples, books, art and people linked to the past.',
        sources: [{ label: 'Columbia University Asia for Educators · The Cultural Revolution, 1966–76', url: 'https://afe.easia.columbia.edu/special/china_1950_son.htm' }], topic: 'mao-china',
      },
    ],
  },
  {
    id: 'weimar',
    groups: [
      {
        level: 1, label: 'Revolts against the Weimar Republic', items: ['Sparta\u00ADcists', 'Kapp Putsch', 'Beer Hall Putsch', 'Hamburg Uprising'],
        explanation: 'The communist Spartacist uprising (January 1919), the right-wing Kapp Putsch (1920), the communist Hamburg Uprising (October 1923) and Hitler’s Beer Hall Putsch in Munich (November 1923) all failed.',
        sources: [{ label: 'Deutsches Historisches Museum · 1923', url: 'https://www.dhm.de/lemo/jahreschronik/1923' }, { label: 'Deutsches Historisches Museum · The Kapp Putsch, 1920', url: 'https://www.dhm.de/lemo/kapitel/weimarer-republik/innenpolitik/luettwitz-kapp-putsch-1920' }],
      },
      {
        level: 2, label: 'Weimar culture', items: ['Bauhaus', 'Metropolis', 'Threepenny Opera', 'The Blue Angel'],
        explanation: 'Walter Gropius founded the Bauhaus school of design in Weimar in 1919. Fritz Lang’s film Metropolis (1927), Brecht and Weill’s The Threepenny Opera (1928) and the film The Blue Angel (1930) are among the era’s best-known works.',
        sources: [{ label: 'Deutsches Historisches Museum · Film and cinema in the Weimar Republic', url: 'https://www.dhm.de/lemo/kapitel/weimarer-republik/kunst-und-kultur/film-und-kino' }, { label: 'Deutsches Historisches Museum · The Bauhaus', url: 'https://www.dhm.de/lemo/kapitel/weimarer-republik/kunst-und-kultur/bauhaus' }],
      },
      {
        level: 3, label: 'Chancellors before Hitler', items: ['Müller', 'Brüning', 'Papen', 'Schleicher'],
        explanation: 'Hermann Müller’s coalition fell in March 1930. Brüning, Papen and Schleicher then governed largely through presidential emergency decrees until Hindenburg appointed Hitler in January 1933.',
        sources: [{ label: 'Deutsches Historisches Museum · Presidential cabinets', url: 'https://www.dhm.de/lemo/kapitel/weimarer-republik/innenpolitik/kabinette-1' }, { label: 'Deutsches Historisches Museum · Cabinets of 1919–1933', url: 'https://www.dhm.de/lemo/kapitel/weimarer-republik/innenpolitik/kabinette' }], topic: 'enabling-act-1933',
      },
      {
        level: 4, label: '___ Plan', items: ['Dawes', 'Young', 'Marshall', 'Schlieffen'],
        explanation: 'The Dawes (1924) and Young (1929) plans rescheduled German reparations; the Marshall Plan (1948) funded European recovery; the Schlieffen Plan shaped Germany’s invasion of Belgium and France in 1914.',
        sources: [{ label: 'Office of the Historian · The Dawes and Young Plans', url: 'https://history.state.gov/milestones/1921-1936/dawes' }, { label: 'Imperial War Museums · The Schlieffen Plan', url: 'https://www.iwm.org.uk/history/first-world-war/outbreak/schlieffen-plan' }],
      },
    ],
  },
  {
    id: 'napoleon',
    groups: [
      {
        level: 1, label: 'Napoleon’s victories', items: ['Austerlitz', 'Jena', 'Wagram', 'Marengo'],
        explanation: 'Napoleon defeated Austria at Marengo (1800) and Wagram (1809), Austria and Russia at Austerlitz (1805), and Prussia at Jena (1806).',
        sources: [{ label: 'Fondation Napoléon · Timeline of the Consulate and First Empire', url: 'https://www.napoleon.org/en/young-historians/napodoc/timeline-consulate1st-french-empire/' }],
      },
      {
        level: 2, label: 'Marshals of the Empire', items: ['Ney', 'Murat', 'Davout', 'Berthier'],
        explanation: 'Napoleon named these commanders among his first marshals in 1804: Ney, Murat (later king of Naples), Davout and his chief of staff Berthier.',
        sources: [{ label: 'Fondation Napoléon · Louis-Alexandre Berthier', url: 'https://www.napoleon.org/histoire-des-2-empires/biographies/berthier-louis-alexandre-1753-1815-prince-de-neufchatel-prince-de-wagram-marechal/' }, { label: 'Fondation Napoléon · Michel Ney', url: 'https://www.napoleon.org/en/history-of-the-two-empires/biographies/ney-michel/' }],
      },
      {
        level: 3, label: 'Created under Napoleon', items: ['Civil Code', 'Concordat', 'Legion of Honour', 'Bank of France'],
        explanation: 'The Bank of France (1800), the Concordat with the papacy (1801), the Legion of Honour (1802) and the Civil Code (1804) outlasted his empire.',
        sources: [{ label: 'Fondation Napoléon · The “masses of granite”: new Napoleonic institutions', url: 'https://www.napoleon.org/en/young-historians/napodoc/les-masses-de-granit-de-nouvelles-institutions-napoleoniennes/' }],
      },
      {
        level: 4, label: 'Islands of exile and imprisonment', items: ['Elba', 'St Helena', 'Robben Island', 'Devil’s Island'],
        explanation: 'Napoleon was exiled to Elba (1814) and St Helena (1815–21). Nelson Mandela spent 18 years in prison on Robben Island, and Alfred Dreyfus was held on Devil’s Island off French Guiana (1895–99).',
        sources: [{ label: 'South African History Online · Robben Island Museum', url: 'https://sahistory.org.za/place/robben-island-museum' }, { label: 'Encyclopaedia Britannica · Devils Island', url: 'https://www.britannica.com/place/Devils-Island' }],
      },
    ],
  },
  {
    id: 'soviet-collapse',
    groups: [
      {
        level: 1, label: 'Gorbachev’s watchwords', items: ['Glasnost', 'Pere\u00ADstroika', 'Uskoreniye', 'Demokra\u00ADtizatsiya'],
        explanation: 'Gorbachev’s early call for acceleration (uskoreniye) of economic growth soon gave way to openness (glasnost), restructuring (perestroika) and democratisation of the Soviet system.',
        sources: [{ label: 'Seventeen Moments in Soviet History · Perestroika and glasnost', url: 'https://soviethistory.msu.edu/1985/perestroika-and-glasnost/' }], topic: 'soviet-collapse-1991',
      },
      {
        level: 2, label: '1989 in central and eastern Europe', items: ['Round Table', 'Baltic Way', 'Pan-European Picnic', 'Velvet Revolution'],
        explanation: 'Poland’s Round Table talks led to semi-free elections. A gate on Hungary’s border with Austria was opened, with official permission, at the Pan-European Picnic on 19 August, and about two million people formed the Baltic Way human chain on 23 August. Czechoslovakia’s Velvet Revolution followed in November.',
        sources: [{ label: 'Federal Government of Germany · The Pan-European Picnic', url: 'https://www.bundesregierung.de/breg-en/service/archive/-pan-european-picnic--1662402' }, { label: 'Baltic Worlds (Södertörn University) · In 1989, there was a wall and a way', url: 'https://balticworlds.com/in-1989-there-was-a-wall-and-a-way/' }],
      },
      {
        level: 3, label: 'Replaced the USSR with the CIS', items: ['Yeltsin', 'Kravchuk', 'Shush\u00ADkevich', 'Nazarbayev'],
        explanation: 'Russia’s Yeltsin, Ukraine’s Kravchuk and Belarus’s Shushkevich declared the Soviet Union at an end at Belovezha on 8 December 1991. Kazakhstan’s Nazarbayev hosted the meeting at Alma-Ata on 21 December where eleven republics founded the wider Commonwealth of Independent States.',
        sources: [{ label: 'Encyclopedia of Ukraine · Belavezha Agreement', url: 'https://www.encyclopediaofukraine.com/display.asp?linkpath=pages%5CB%5CE%5CBelavezhaAgreement.htm' }, { label: 'E-history.kz · The USSR and the CIS', url: 'https://e-history.kz/en/news/show/7522' }], topic: 'soviet-collapse-1991',
      },
      {
        level: 4, label: 'Russia’s economy in the 1990s', items: ['Shock therapy', 'Vouchers', 'Loans for shares', 'Default'],
        explanation: 'Freeing prices in January 1992 began shock therapy; vouchers given to every citizen could be exchanged for shares in privatised firms; the loans-for-shares deals of 1995 passed major companies to a few tycoons; in August 1998 Russia defaulted on its debt.',
        sources: [{ label: 'Encyclopedia of Russian History · Boris Yeltsin', url: 'https://www.encyclopedia.com/people/history/russian-soviet-and-cis-history-biographies/boris-nikolayevich-yeltsin' }, { label: 'Encyclopedia of Russian History · Federal Property Fund', url: 'https://www.encyclopedia.com/history/encyclopedias-almanacs-transcripts-and-maps/federal-property-fund' }], topic: 'soviet-collapse-1991',
      },
    ],
  },
  {
    id: 'acronyms',
    groups: [
      {
        level: 1, label: 'Secret police forces', items: ['Cheka', 'KGB', 'Stasi', 'SAVAK'],
        explanation: 'Lenin’s Cheka (1917), the Soviet KGB (1954–91), East Germany’s Stasi and SAVAK under the shah of Iran used surveillance, informers and imprisonment against people seen as enemies; the Cheka and SAVAK also carried out torture and executions.',
        sources: [{ label: 'Encyclopaedia Britannica · KGB', url: 'https://www.britannica.com/topic/KGB' }, { label: 'Encyclopaedia Britannica · Intelligence: Iran', url: 'https://www.britannica.com/topic/intelligence-international-relations/Iran' }],
      },
      {
        level: 2, label: 'Cold War alliances', items: ['NATO', 'SEATO', 'CENTO', 'ANZUS'],
        explanation: 'The North Atlantic Treaty Organization (1949), ANZUS between Australia, New Zealand and the United States (1951), the Southeast Asia Treaty Organization (1954) and the Central Treaty Organization, the former Baghdad Pact (1955–79).',
        sources: [{ label: 'Office of the Historian · Southeast Asia Treaty Organization (SEATO), 1954', url: 'https://history.state.gov/milestones/1953-1960/seato' }, { label: 'Encyclopaedia Britannica · Central Treaty Organization', url: 'https://www.britannica.com/topic/Central-Treaty-Organization' }],
      },
      {
        level: 3, label: 'US civil rights organisations', items: ['NAACP', 'SNCC', 'CORE', 'SCLC'],
        explanation: 'The NAACP (1909) fought segregation in the courts; CORE (1942) organised the Freedom Rides; the SCLC (1957), led by Martin Luther King Jr, coordinated nonviolent campaigns; SNCC (1960) grew out of the student sit-ins.',
        sources: [{ label: 'Martin Luther King, Jr. Research and Education Institute (Stanford) · Congress of Racial Equality (CORE)', url: 'https://kinginstitute.stanford.edu/congress-racial-equality-core' }, { label: 'Martin Luther King, Jr. Research and Education Institute (Stanford) · Student Nonviolent Coordinating Committee (SNCC)', url: 'https://kinginstitute.stanford.edu/student-nonviolent-coordinating-committee-sncc' }], topic: 'us-civil-rights-movement',
      },
      {
        level: 4, label: 'South African anti-apartheid organisations', items: ['ANC', 'PAC', 'MK', 'UDF'],
        explanation: 'The African National Congress (founded 1912), the Pan Africanist Congress (1959), Umkhonto we Sizwe (MK), the armed wing formed by ANC and Communist Party leaders in 1961, and the United Democratic Front (1983) opposed apartheid.',
        sources: [{ label: 'South African History Online · African National Congress (ANC)', url: 'https://sahistory.org.za/article/african-national-congress-anc' }, { label: 'South African History Online · United Democratic Front (UDF)', url: 'https://sahistory.org.za/article/united-democratic-front-udf' }], topic: 'apartheid-south-africa',
      },
    ],
  },
  {
    id: 'july-1914',
    groups: [
      {
        level: 1, label: 'The “MAIN” causes', items: ['Militarism', 'Alliances', 'Imperial\u00ADism', 'National\u00ADism'],
        explanation: 'A classroom memory aid for long-term pressures behind the First World War. Historians also weigh the decisions leaders took in July 1914.',
        sources: [{ label: 'Imperial War Museums · Outbreak of the First World War', url: 'https://www.iwm.org.uk/history/first-world-war/outbreak' }], topic: 'first-world-war-causes',
      },
      {
        level: 2, label: 'The Central Powers', items: ['Germany', 'Austria-Hungary', 'Ottoman Empire', 'Bulgaria'],
        explanation: 'Germany and Austria-Hungary were joined by the Ottoman Empire in 1914 and Bulgaria in 1915. Italy, their pre-war partner in the Triple Alliance, entered the war on the Allied side in 1915.',
        sources: [{ label: 'Encyclopaedia Britannica · Central Powers', url: 'https://www.britannica.com/topic/Central-Powers' }],
      },
      {
        level: 3, label: 'Steps in the July Crisis', items: ['Sarajevo', 'Blank cheque', 'Ultimatum', 'Mobili\u00ADsation'],
        explanation: 'The assassination at Sarajevo (28 June 1914), Germany’s “blank cheque” to Austria-Hungary (5–6 July), Austria-Hungary’s ultimatum to Serbia (23 July) and Russian general mobilisation (30 July) turned a Balkan crisis into a European war.',
        sources: [{ label: 'Imperial War Museums · Outbreak of the First World War', url: 'https://www.iwm.org.uk/history/first-world-war/outbreak' }], topic: 'first-world-war-causes',
      },
      {
        level: 4, label: 'The Anglo-German naval race', items: ['Dread\u00ADnought', 'Tirpitz', 'Fisher', 'Navy Laws'],
        explanation: 'Admiral Tirpitz’s Navy Laws (from 1898) expanded the German fleet. Admiral Fisher championed HMS Dreadnought (1906), whose design made older battleships obsolete and intensified the race.',
        sources: [{ label: 'Imperial War Museums · The naval race between Britain and Germany', url: 'https://www.iwm.org.uk/history/first-world-war/outbreak/naval-arms-race' }, { label: 'Deutsches Historisches Museum · Naval construction', url: 'https://www.dhm.de/lemo/kapitel/kaiserreich/aussenpolitik/flottenbau' }], topic: 'first-world-war-causes',
      },
    ],
  },
  {
    id: 'year-by-year',
    groups: [
      {
        level: 1, label: '1870', items: ['Ems Dispatch', 'Gravelotte', 'Sedan', 'Porta Pia'],
        explanation: 'Bismarck’s Ems Dispatch helped start the Franco-Prussian War in July. German armies won at Gravelotte and Sedan; French troops left Rome, and Italian soldiers entered through a breach at Porta Pia on 20 September.',
        sources: [{ label: 'Deutsches Historisches Museum · The Franco-Prussian War, 1870–71', url: 'https://www.dhm.de/lemo/kapitel/kaiserreich/reich/krieg1870' }, { label: 'Turismo Roma · The breach of Porta Pia', url: 'https://turismoroma.it/en/page/september-rome-key-dates-and-events-today-past' }], topic: 'german-empire-1871',
      },
      {
        level: 2, label: '1866', items: ['Königgrätz', 'Custoza', 'Lissa', 'Treaty of Prague'],
        explanation: 'Italy allied with Prussia against Austria. Prussia won at Königgrätz; Austria beat Italy on land at Custoza and at sea off Lissa, yet Italy still gained Venetia. The Treaty of Prague ended the Austro-Prussian War.',
        sources: [{ label: 'Deutsches Historisches Museum · 1866', url: 'https://www.dhm.de/lemo/jahreschronik/1866' }],
      },
      {
        level: 3, label: '1860', items: ['The Thousand', 'Calatafimi', 'Castel\u00ADfidardo', 'Teano'],
        explanation: 'Garibaldi’s Thousand landed in Sicily in May and won at Calatafimi. Piedmont’s army beat papal forces at Castelfidardo in September, and Garibaldi met Victor Emmanuel II near Teano in October.',
        sources: [{ label: 'Encyclopaedia Britannica · Expedition of the Thousand', url: 'https://www.britannica.com/event/Expedition-of-the-Thousand' }, { label: 'Italian Ministry of Culture (VIVE) · Castelfidardo, 18 September 1860', url: 'https://vive.cultura.gov.it/_cms/en/central-museum-risorgimento/not-miss/sketch-memorial-general-cialdini-and-fallen-battle-18th' }], topic: 'kingdom-italy-1861',
      },
      {
        level: 4, label: '1859', items: ['Magenta', 'Solferino', 'San Martino', 'Villa\u00ADfranca'],
        explanation: 'France and Piedmont defeated Austria at Magenta in June and at Solferino and San Martino on the 24th. Napoleon III then agreed an armistice with Austria at Villafranca, leaving Venetia Austrian. Villafranca saw fighting again during Custoza in 1866, but only it completes 1859.',
        sources: [{ label: 'Deutsches Historisches Museum · 1859', url: 'https://www.dhm.de/lemo/jahreschronik/1859' }, { label: 'Treccani · The armistice of Villafranca', url: 'https://www.treccani.it/enciclopedia/armistizio-di-villafranca_(Dizionario-di-Storia)/' }],
      },
    ],
  },
  {
    id: 'russia-1917',
    groups: [
      {
        level: 1, label: 'Parties of revolutionary Russia', items: ['Bolsheviks', 'Mensheviks', 'SRs', 'Kadets'],
        explanation: 'Russia’s Marxist Social Democrats split into Bolsheviks and Mensheviks in 1903. The Socialist Revolutionaries (SRs) spoke for the peasants; the liberal Kadets wanted a constitutional, parliamentary state.',
        sources: [{ label: 'Seventeen Moments in Soviet History · Glossary', url: 'https://soviethistory.msu.edu/glossary/' }], topic: 'russian-revolutions',
      },
      {
        level: 2, label: 'Turning points of 1917', items: ['February Revolution', 'April Theses', 'July Days', 'Kornilov Affair'],
        explanation: 'Revolution toppled the tsar in February. Lenin’s April Theses rejected support for the Provisional Government; the July Days unrest failed; General Kornilov’s apparent attempted coup in August strengthened the Bolsheviks.',
        sources: [{ label: 'Seventeen Moments in Soviet History · Kornilov Affair', url: 'https://soviethistory.msu.edu/1917/kornilov-affair/' }, { label: 'Seventeen Moments in Soviet History · April Crisis', url: 'https://soviethistory.msu.edu/1917/april-crisis/' }], topic: 'russian-revolutions',
      },
      {
        level: 3, label: 'White commanders in the Civil War', items: ['Kolchak', 'Denikin', 'Wrangel', 'Yudenich'],
        explanation: 'Admiral Kolchak in Siberia, Denikin and later Wrangel in the south, and Yudenich near Petrograd led White armies against the Bolsheviks in 1918–20.',
        sources: [{ label: 'Encyclopedia of Russian History (Encyclopedia.com) · White Army', url: 'https://www.encyclopedia.com/history/encyclopedias-almanacs-transcripts-and-maps/white-army' }, { label: 'Seventeen Moments in Soviet History · Personages', url: 'https://soviethistory.msu.edu/personages/' }],
      },
      {
        level: 4, label: 'Lenin’s government, 1917–24', items: ['Cheka', 'Brest-Litovsk', 'War Communism', 'NEP'],
        explanation: 'Lenin’s government created the Cheka (1917) and made peace with Germany and its allies at Brest-Litovsk (1918). It seized grain and nationalised industry under War Communism, then allowed private trade again under the New Economic Policy (1921).',
        sources: [{ label: 'Seventeen Moments in Soviet History · Lenin Introduces NEP', url: 'https://soviethistory.msu.edu/1921/new-economic-policy/' }, { label: 'Seventeen Moments in Soviet History · Treaty of Brest Litovsk', url: 'https://soviethistory.msu.edu/1917/treaty-of-brest-litovsk/' }], topic: 'russian-revolutions',
      },
    ],
  },
  {
    id: 'nobel-and-un',
    groups: [
      {
        level: 1, label: 'Canadian prime ministers', items: ['Macdonald', 'Diefen\u00ADbaker', 'Pearson', 'Trudeau'],
        explanation: 'John A. Macdonald was Canada’s first prime minister (1867). John Diefenbaker (1957–63), Lester Pearson (1963–68) and Pierre Trudeau (1968–79, 1980–84) governed during the Cold War. Pearson won the Nobel Peace Prize in 1957, so he is not a 1960s laureate.',
        sources: [{ label: 'The Canadian Encyclopedia · Prime Minister of Canada', url: 'https://thecanadianencyclopedia.ca/en/article/prime-ministers-of-canada' }, { label: 'Nobel Prize · The Nobel Peace Prize 1957', url: 'https://www.nobelprize.org/prizes/peace/1957/summary/' }],
      },
      {
        level: 2, label: 'Leaders in the Suez Crisis', items: ['Nasser', 'Eden', 'Mollet', 'Ben-Gurion'],
        explanation: 'Egypt’s Nasser nationalised the Suez Canal in July 1956. Britain’s Eden, France’s Mollet and Israel’s Ben-Gurion secretly planned the invasion that followed. Pearson’s proposal for a UN force helped end the crisis.',
        sources: [{ label: 'Office of the Historian · The Suez Crisis, 1956', url: 'https://history.state.gov/milestones/1953-1960/suez' }, { label: 'Office of the Historian · Foreign Relations of the United States, 1955–1957, vol. XVI, doc. 373 (Editorial Note)', url: 'https://history.state.gov/historicaldocuments/frus1955-57v16/d373' }],
      },
      {
        level: 3, label: 'UN secretaries-general', items: ['Lie', 'U Thant', 'Waldheim', 'Annan'],
        explanation: 'Trygve Lie (1946–52), U Thant (1961–71), Kurt Waldheim (1972–81) and Kofi Annan (1997–2006) led the United Nations. Dag Hammarskjöld, who served from 1953 to 1961, belongs with the Nobel laureates.',
        sources: [{ label: 'United Nations Archives · Secretaries-General', url: 'https://archives.un.org/en/content/secretaries-general' }],
      },
      {
        level: 4, label: 'Nobel Peace Prize laureates of the 1960s', items: ['Luthuli', 'Hammar\u00ADskjöld', 'King', 'Cassin'],
        explanation: 'Albert Luthuli (the prize for 1960), Dag Hammarskjöld (1961, awarded after his death), Martin Luther King Jr (1964) and René Cassin, an author of the Universal Declaration of Human Rights (1968). Mackenzie King was a prime minister, but this King is the civil rights leader.',
        sources: [{ label: 'Nobel Prize · The Nobel Peace Prize 1960', url: 'https://www.nobelprize.org/prizes/peace/1960/summary/' }, { label: 'Nobel Prize · The Nobel Peace Prize 1961', url: 'https://www.nobelprize.org/prizes/peace/1961/summary/' }],
      },
    ],
  },
  {
    id: 'propaganda',
    groups: [
      {
        level: 1, label: 'Party newspapers', items: ['Pravda', 'Völkischer Beobachter', 'People’s Daily', 'Il Popolo d’Italia'],
        explanation: 'Pravda was the Soviet Communist Party’s newspaper, the Völkischer Beobachter the Nazi Party’s and People’s Daily the Chinese Communist Party’s. Mussolini founded Il Popolo d’Italia in 1914; it became the Fascist Party’s semi-official mouthpiece.',
        sources: [{ label: 'Treccani · Popolo d’Italia, Il', url: 'https://www.treccani.it/enciclopedia/il-popolo-d-italia/' }, { label: 'People’s Daily Online · About People’s Daily', url: 'https://en.people.cn/english/199806/29/about.htm' }],
      },
      {
        level: 2, label: 'Films that served regimes', items: ['Triumph of the Will', 'Olympia', 'Battleship Potemkin', 'Alexander Nevsky'],
        explanation: 'Leni Riefenstahl filmed the 1934 Nuremberg rally in Triumph of the Will and the 1936 Berlin Olympics in Olympia. Sergei Eisenstein’s Battleship Potemkin (1925) and Alexander Nevsky (1938) served Soviet purposes.',
        sources: [{ label: 'US Holocaust Memorial Museum · Leni Riefenstahl', url: 'https://encyclopedia.ushmm.org/content/en/article/leni-riefenstahl' }, { label: 'Seventeen Moments in Soviet History · The New Patriotism', url: 'https://soviethistory.msu.edu/1939/new-patriotism/' }],
      },
      {
        level: 3, label: 'Books promoted by regimes', items: ['Mein Kampf', 'Little Red Book', 'Green Book', 'Doctrine of Fascism'],
        explanation: 'Hitler’s Mein Kampf (1925–26), the Quotations from Chairman Mao (1964), Gaddafi’s Green Book (from the mid-1970s) and The Doctrine of Fascism, published under Mussolini’s name in 1932, were promoted as guides to their regimes’ ideas.',
        sources: [{ label: 'Fordham University Internet History Sourcebooks · Benito Mussolini: What is Fascism, 1932', url: 'https://sourcebooks.fordham.edu/mod/mussolini-fascism.asp' }, { label: 'International Encyclopedia of the Social Sciences (Encyclopedia.com) · Green Book, The (Libya)', url: 'https://www.encyclopedia.com/social-sciences/applied-and-social-sciences-magazines/green-book-libya' }],
      },
      {
        level: 4, label: 'Authors whose books were burned in 1933', items: ['Remarque', 'Freud', 'Brecht', 'Kästner'],
        explanation: 'On 10 May 1933 students in Berlin and other university towns burned books by these writers and many others, including Erich Maria Remarque’s anti-war novel All Quiet on the Western Front.',
        sources: [{ label: 'US Holocaust Memorial Museum · Book Burning', url: 'https://encyclopedia.ushmm.org/content/en/article/book-burning' }, { label: 'German History in Documents and Images · The Book Burning: Report by Louis P. Lochner (10 May 1933)', url: 'https://germanhistorydocs.org/en/nazi-germany-1933-1945/the-book-burning-report-by-louis-p-lochner-head-of-the-berlin-bureau-of-the-associated-press-may-10-1933' }],
      },
    ],
  },
  {
    id: 'spanish-civil-war',
    groups: [
      {
        level: 1, label: 'Writers and artists of the war', items: ['Orwell', 'Hemingway', 'Picasso', 'Capa'],
        explanation: 'Orwell fought with the POUM militia and wrote Homage to Catalonia; Hemingway reported from the Republican side; Picasso painted Guernica after the 1937 bombing; Robert Capa photographed the fighting.',
        sources: [{ label: 'The Orwell Foundation · Biography', url: 'https://www.orwellfoundation.com/the-orwell-foundation/orwell/biography/' }, { label: 'Museo Reina Sofía · Guernica', url: 'https://www.museoreinasofia.es/en/collections/artwork/guernica-0/' }], topic: 'spanish-civil-war',
      },
      {
        level: 2, label: 'Battles of the war', items: ['Jarama', 'Guadala\u00ADjara', 'Brunete', 'Ebro'],
        explanation: 'In 1937 Republican forces stopped the Nationalist drive to cut Madrid’s road to Valencia at the Jarama and defeated Italian troops at Guadalajara. Their offensives at Brunete (1937) and on the Ebro (1938), the war’s longest battle, ended in heavy losses.',
        sources: [{ label: 'Abraham Lincoln Brigade Archives · The war from the defense of Madrid to March 1939', url: 'https://alba-valb.org/resource/the-war-from-the-defense-of-madrid-to-march-1939/' }, { label: 'University of Warwick Modern Records Centre · Illustrated timeline of the Spanish Civil War', url: 'https://warwick.ac.uk/services/library/mrc/collections/digital/scw/timeline2/' }], topic: 'spanish-civil-war',
      },
      {
        level: 3, label: 'On the Nationalist side', items: ['Franco', 'Falange', 'Carlists', 'Condor Legion'],
        explanation: 'General Franco led the Nationalists and in 1937 merged the fascist Falange and the monarchist Carlists into one movement. Germany’s Condor Legion led the bombing of Guernica.',
        sources: [{ label: 'University of Warwick Modern Records Centre · Illustrated timeline of the Spanish Civil War', url: 'https://warwick.ac.uk/services/library/mrc/collections/digital/scw/timeline2/' }, { label: 'Museo Reina Sofía · Guernica', url: 'https://www.museoreinasofia.es/en/collections/artwork/guernica-0/' }], topic: 'spanish-civil-war',
      },
      {
        level: 4, label: 'On the Republican side', items: ['Popular Front', 'CNT', 'POUM', 'Inter\u00ADnational Brigades'],
        explanation: 'The Popular Front coalition won the February 1936 election. The anarchist CNT trade union and the anti-Stalinist Marxist POUM raised militias, and the International Brigades brought volunteers from dozens of countries. The writers and artists sided with the Republic too, but only they complete their own group.',
        sources: [{ label: 'University of Warwick Modern Records Centre · The International Brigade', url: 'https://warwick.ac.uk/services/library/mrc/collections/digital/scw/brigade/' }, { label: 'Encyclopedia of Modern Europe: Europe Since 1914 (Encyclopedia.com) · International Brigades', url: 'https://www.encyclopedia.com/history/encyclopedias-almanacs-transcripts-and-maps/international-brigades' }], topic: 'spanish-civil-war',
      },
    ],
  },
  {
    id: 'mongols',
    groups: [
      {
        level: 1, label: 'Cities taken by Mongol armies', items: ['Bukhara', 'Samarkand', 'Kyiv', 'Baghdad'],
        explanation: 'Genghis Khan’s armies took Bukhara and Samarkand in 1220; Batu’s army sacked Kyiv in 1240; Hülegü’s forces destroyed Baghdad and ended the Abbasid caliphate in 1258.',
        sources: [{ label: 'Encyclopaedia Iranica · Čengīz Khan', url: 'https://www.iranicaonline.org/articles/cengiz-khan/' }, { label: 'Encyclopedia of Ukraine · Batu Khan', url: 'https://www.encyclopediaofukraine.com/display.asp?linkpath=pages%5CB%5CA%5CBatuKhan.htm' }], topic: 'genghis-khan',
      },
      {
        level: 2, label: 'Sons of Genghis Khan', items: ['Jochi', 'Chagatai', 'Ögedei', 'Tolui'],
        explanation: 'His four sons by his chief wife, Börte. Ögedei succeeded his father as Great Khan in 1229; Jochi’s and Chagatai’s descendants ruled western khanates.',
        sources: [{ label: 'Encyclopaedia Iranica · Mongols', url: 'https://www.iranicaonline.org/articles/mongols/' }], topic: 'genghis-khan',
      },
      {
        level: 3, label: 'Grandsons of Genghis Khan', items: ['Batu', 'Möngke', 'Kublai', 'Hülegü'],
        explanation: 'Batu, Jochi’s son, founded the Golden Horde. Tolui’s sons Möngke became Great Khan in 1251, Kublai founded the Yuan dynasty in China and Hülegü the Ilkhanate in Persia.',
        sources: [{ label: 'Encyclopaedia Iranica · Mongols', url: 'https://www.iranicaonline.org/articles/mongols/' }, { label: 'Gale Encyclopedia of World History: War (Encyclopedia.com) · Mongol Conquests (1200–1400)', url: 'https://www.encyclopedia.com/history/encyclopedias-almanacs-transcripts-and-maps/mongol-conquests-1200-1400' }],
      },
      {
        level: 4, label: 'Mongol institutions', items: ['Kurultai', 'Keshig', 'Yam', 'Tumen'],
        explanation: 'A kurultai was an assembly that chose khans; the keshig was the khan’s guard; the yam was a network of relay stations for messengers; a tumen was an army unit of ten thousand.',
        sources: [{ label: 'Brill · Charles Melville, ‘The Keshig in Iran: The Survival of the Royal Mongol Household’ (preview)', url: 'https://brill.com/previewpdf/display/book/edcoll/9789047418573/BP000011.xml' }, { label: 'Gale Encyclopedia of World History: War (Encyclopedia.com) · Mongol Conquests (1200–1400)', url: 'https://www.encyclopedia.com/history/encyclopedias-almanacs-transcripts-and-maps/mongol-conquests-1200-1400' }], topic: 'genghis-khan',
      },
    ],
  },
  {
    id: 'rights-and-protest',
    groups: [
      {
        level: 1, label: 'US civil rights leaders', items: ['Martin Luther King', 'Rosa Parks', 'Malcolm X', 'John Lewis'],
        explanation: 'Martin Luther King Jr and Rosa Parks were leading figures of the Montgomery bus boycott; Malcolm X argued for Black self-defence and pride; John Lewis chaired SNCC and was beaten at Selma in 1965.',
        sources: [{ label: 'Martin Luther King, Jr. Research and Education Institute (Stanford) · Montgomery Bus Boycott', url: 'https://kinginstitute.stanford.edu/montgomery-bus-boycott' }, { label: 'Martin Luther King, Jr. Research and Education Institute (Stanford) · Lewis, John', url: 'https://kinginstitute.stanford.edu/lewis-john' }], topic: 'us-civil-rights-movement',
      },
      {
        level: 2, label: 'Anti-apartheid leaders', items: ['Mandela', 'Sisulu', 'Tambo', 'Sobukwe'],
        explanation: 'Nelson Mandela, Walter Sisulu and Oliver Tambo led the ANC’s younger generation from the 1940s; Robert Sobukwe broke away to found the Pan Africanist Congress in 1959.',
        sources: [{ label: 'South African History Online · African National Congress Youth League (ANCYL)', url: 'https://sahistory.org.za/article/african-national-congress-youth-league-ancyl' }, { label: 'South African History Online · Robert Sobukwe', url: 'https://sahistory.org.za/people/robert-sobukwe' }], topic: 'apartheid-south-africa',
      },
      {
        level: 3, label: 'Places of US civil rights campaigns', items: ['Montgomery', 'Little Rock', 'Birmingham', 'Selma'],
        explanation: 'The bus boycott began in Montgomery in 1955 and nine Black students entered Little Rock Central High School in 1957. The Birmingham campaign (1963) and the Selma marches (1965) helped win new federal civil rights and voting laws.',
        sources: [{ label: 'Martin Luther King, Jr. Research and Education Institute (Stanford) · Selma to Montgomery March', url: 'https://kinginstitute.stanford.edu/selma-montgomery-march' }, { label: 'Martin Luther King, Jr. Research and Education Institute (Stanford) · Little Rock School Desegregation', url: 'https://kinginstitute.stanford.edu/little-rock-school-desegregation' }], topic: 'us-civil-rights-movement',
      },
      {
        level: 4, label: 'Places of apartheid and resistance', items: ['Sharpe\u00ADville', 'Rivonia', 'Soweto', 'District Six'],
        explanation: 'Police killed 69 protesters at Sharpeville in 1960, and ANC leaders were arrested at Rivonia in 1963. Soweto students rose against teaching in Afrikaans in 1976. District Six in Cape Town was declared a white area in 1966 and its residents forcibly removed.',
        sources: [{ label: 'South African History Online · Rivonia Trial 1963–1964', url: 'https://sahistory.org.za/article/rivonia-trial-1963-1964' }, { label: 'District Six Museum · About District Six', url: 'https://www.districtsix.co.za/about-district-six/' }], topic: 'apartheid-south-africa',
      },
    ],
  },
  {
    id: 'decolonisation',
    groups: [
      {
        level: 1, label: 'First leaders of independent states', items: ['Nehru', 'Nkrumah', 'Kenyatta', 'Sukarno'],
        explanation: 'Jawaharlal Nehru became India’s first prime minister in 1947, Kwame Nkrumah led Ghana from independence in 1957, Jomo Kenyatta led Kenya from 1963 and Sukarno proclaimed Indonesia’s independence in 1945.',
        sources: [{ label: 'Imperial War Museums · Britain and Decolonisation in South-East and South Asia', url: 'https://www.iwm.org.uk/history/cold-war/end-of-empire/britain-and-decolonisation-in-south-east-and-south-asia' }, { label: 'Imperial War Museums · Kenya Emergency key facts', url: 'https://www.iwm.org.uk/history/cold-war/end-of-empire/kenya-emergency/kenya-emergency-explained' }],
      },
      {
        level: 2, label: 'Colonial names', items: ['Gold Coast', 'Ceylon', 'Rhodesia', 'Dutch East Indies'],
        explanation: 'The Gold Coast became Ghana (1957), Ceylon became Sri Lanka (1972), Southern Rhodesia, called Rhodesia by its white-minority regime, became Zimbabwe (1980), and the Dutch East Indies became Indonesia (independence declared in 1945, recognised in 1949).',
        sources: [{ label: 'Imperial War Museums · Britain and Decolonisation in South-East and South Asia', url: 'https://www.iwm.org.uk/history/cold-war/end-of-empire/britain-and-decolonisation-in-south-east-and-south-asia' }, { label: 'Office of the Historian · Zimbabwe', url: 'https://history.state.gov/countries/zimbabwe' }],
      },
      {
        level: 3, label: 'Independence movements', items: ['Mau Mau', 'FLN', 'Viet Minh', 'Congress'],
        explanation: 'Kenya’s Mau Mau uprising (1952–60), Algeria’s National Liberation Front (FLN), Ho Chi Minh’s Viet Minh and the Indian National Congress, founded in 1885, fought colonial rule in very different ways.',
        sources: [{ label: 'Imperial War Museums · Kenya Emergency key facts', url: 'https://www.iwm.org.uk/history/cold-war/end-of-empire/kenya-emergency/kenya-emergency-explained' }, { label: 'Imperial War Museums · Partition of India in 1947', url: 'https://www.iwm.org.uk/history/second-world-war/india/partition' }],
      },
      {
        level: 4, label: 'Turning points of decolonisation', items: ['Amritsar', 'Salt March', 'Dien Bien Phu', 'Suez'],
        explanation: 'The Amritsar massacre (1919) and Gandhi’s Salt March (1930) mobilised Indian opinion against British rule. France’s defeat at Dien Bien Phu (1954) led to the end of its rule in Indochina, and the Suez Crisis (1956) exposed the limits of British and French power.',
        sources: [{ label: 'Imperial War Museums · Partition of India in 1947', url: 'https://www.iwm.org.uk/history/second-world-war/india/partition' }, { label: 'Office of the Historian · Dien Bien Phu & the Fall of French Indochina, 1954', url: 'https://history.state.gov/milestones/1953-1960/dien-bien-phu' }],
      },
    ],
  },
  {
    id: 'industrial-britain',
    groups: [
      {
        level: 1, label: 'Protest in industrial Britain', items: ['Luddites', 'Peterloo', 'Tolpuddle Martyrs', 'Chartists'],
        explanation: 'Luddites broke machines in 1811–16; cavalry killed peaceful reformers at Peterloo in Manchester in 1819; the Tolpuddle Martyrs, Dorset farm labourers, were transported in 1834 for swearing a secret oath when forming a union; the Chartists campaigned for votes for all men from 1838.',
        sources: [{ label: 'The National Archives · The Peterloo Massacre', url: 'https://www.nationalarchives.gov.uk/explore-the-collection/explore-by-time-period/georgians/the-peterloo-massacre/' }, { label: 'Tolpuddle Martyrs Museum · The Story', url: 'https://www.tolpuddlemartyrs.org.uk/story' }],
      },
      {
        level: 2, label: 'Textile machines', items: ['Flying shuttle', 'Spinning jenny', 'Water frame', 'Power loom'],
        explanation: 'John Kay’s flying shuttle (1733), James Hargreaves’s spinning jenny (mid-1760s), Richard Arkwright’s water frame (1769) and Edmund Cartwright’s power loom (1785) mechanised weaving and spinning.',
        sources: [{ label: 'Science Museum Group · Reproduction of Hargreaves’s original Spinning Jenny', url: 'https://collection.sciencemuseumgroup.org.uk/objects/co44855/reproduction-of-hargreavess-original-spinning-jenny' }, { label: 'Science Museum Group · Richard Arkwright', url: 'https://collection.sciencemuseumgroup.org.uk/people/cp36992/richard-arkwright' }],
      },
      {
        level: 3, label: 'Early locomotives', items: ['Rocket', 'Puffing Billy', 'Locomotion', 'Novelty'],
        explanation: 'Puffing Billy (1813–14) hauled coal near Newcastle; Locomotion No. 1 opened the Stockton and Darlington Railway in 1825; Rocket beat Novelty and others at the Rainhill trials of 1829.',
        sources: [{ label: 'Science Museum Group · Rocket locomotive', url: 'https://collection.sciencemuseumgroup.org.uk/objects/co26704/rocket-locomotive' }, { label: 'Science Museum Group · William Hedley', url: 'https://collection.sciencemuseumgroup.org.uk/people/cp31243/william-hedley' }],
      },
      {
        level: 4, label: 'Inventors of the Industrial Revolution', items: ['Watt', 'Crompton', 'Kay', 'Cartwright'],
        explanation: 'James Watt’s separate condenser (1769) made steam engines far more efficient; Samuel Crompton’s spinning mule (1779), John Kay’s flying shuttle and Edmund Cartwright’s power loom transformed textiles. Kay’s and Cartwright’s machines are tiles too, in the other group.',
        sources: [{ label: 'Science Museum Group · James Watt', url: 'https://collection.sciencemuseumgroup.org.uk/people/cp37593/james-watt' }, { label: 'Science Museum Group · Samuel Crompton', url: 'https://collection.sciencemuseumgroup.org.uk/people/cp37183/samuel-crompton' }],
      },
    ],
  },
];
