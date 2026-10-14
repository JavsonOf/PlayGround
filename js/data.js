/* Game Dev Tycoon 2.5D — static game data */
window.DT = window.DT || {};
DT.TOPICS = [
  {id:'fantasy', name:'Fantasy', icon:'🧙', rp:0},
  {id:'scifi', name:'Sci-Fi', icon:'🚀', rp:0},
  {id:'pirates', name:'Pirates', icon:'🏴‍☠️', rp:0},
  {id:'sports', name:'Sports', icon:'⚽', rp:0},
  {id:'horror', name:'Horror', icon:'👻', rp:20},
  {id:'mystery', name:'Mystery', icon:'🔍', rp:20},
  {id:'romance', name:'Romance', icon:'💘', rp:30},
  {id:'history', name:'History', icon:'🏛️', rp:30},
  {id:'cyber', name:'Cyberpunk', icon:'🌃', rp:50},
  {id:'space', name:'Space Opera', icon:'🪐', rp:50},
  {id:'dungeon', name:'Dungeon Crawl', icon:'🗡️', rp:70},
  {id:'superhero', name:'Superheroes', icon:'🦸', rp:70},
  {id:'postapo', name:'Post-Apo', icon:'☢️', rp:100},
  {id:'timtravel', name:'Time Travel', icon:'⏳', rp:120},
  {id:'aliens', name:'Aliens', icon:'👽', rp:140},
  {id:'wildwest', name:'Wild West', icon:'🤠', rp:160},
];
DT.GENRES = [
  {id:'action', name:'Action', icon:'💥', design:35, tech:65, desc:'Tech-heavy reflex fun'},
  {id:'adventure', name:'Adventure', icon:'🗺️', design:60, tech:40, desc:'Story & exploration'},
  {id:'rpg', name:'RPG', icon:'⚔️', design:70, tech:30, desc:'Deep stories, big design'},
  {id:'strategy', name:'Strategy', icon:'♟️', design:55, tech:45, desc:'Brains over reflexes'},
  {id:'sim', name:'Simulation', icon:'🏗️', design:45, tech:55, desc:'Systems & realism'},
  {id:'casual', name:'Casual', icon:'🍬', design:50, tech:50, desc:'Pick-up-and-play'},
];
/* Great combos give +1 review bonus (GDT-style discovery) */
DT.GREAT_COMBOS = ['rpg|fantasy','rpg|dungeon','adventure|pirates','adventure|mystery','action|superhero','strategy|history','strategy|space','sim|sports','casual|romance','action|wildwest','rpg|cyber','sim|space'];
DT.GOOD_COMBOS = ['action|scifi','adventure|fantasy','rpg|horror','strategy|postapo','sim|history','casual|sports','adventure|timtravel','action|aliens'];
DT.PLATFORMS = [
  {id:'pc', name:'PC', icon:'🖥️', fromY:1, toY:99, share:34, license:0, devCost:1.0, audience:'Everyone'},
  {id:'g64', name:'G64', icon:'📺', fromY:1, toY:5, share:40, license:5000, devCost:0.8, audience:'Retro kids'},
  {id:'tes', name:'TES', icon:'🎛️', fromY:2, toY:6, share:55, license:15000, devCost:1.0, audience:'Huge!'},
  {id:'super', name:'Super TES', icon:'🕹️', fromY:4, toY:8, share:60, license:25000, devCost:1.2, audience:'Massive'},
  {id:'playsys', name:'PlaySystem', icon:'💿', fromY:6, toY:12, share:65, license:40000, devCost:1.4, audience:'CD era!'},
  {id:'gamegirl', name:'GameGirl', icon:'📱', fromY:5, toY:14, share:35, license:20000, devCost:0.9, audience:'Handheld'},
  {id:'phone', name:'Pear Phone', icon:'🤳', fromY:9, toY:99, share:70, license:10000, devCost:0.7, audience:'Everyone +'},
  {id:'vr', name:'VR One', icon:'🥽', fromY:12, toY:99, share:25, license:60000, devCost:1.8, audience:'Niche hardcore'},
];
DT.SIZES = [
  {id:'small', name:'Small game', icon:'🌱', weeks:4, needStaff:1, cost:8000, rp:4, hype:6, price:9.99, desc:'Quick & cheap. Perfect for the garage.'},
  {id:'medium', name:'Medium game', icon:'🌿', weeks:8, needStaff:2, cost:30000, rp:10, hype:12, price:19.99, desc:'Needs 2+ staff. Bigger sales.'},
  {id:'large', name:'Large game', icon:'🌳', weeks:14, needStaff:4, cost:90000, rp:18, hype:20, price:39.99, desc:'Needs 4+ staff + 3D Graphics lab.'},
  {id:'aaa', name:'AAA game', icon:'🏔️', weeks:22, needStaff:6, cost:250000, rp:30, hype:32, price:59.99, desc:'Needs 6+ staff + full engine lab.'},
];
DT.OFFICES = [
  {id:'garage', name:'Garage Office', icon:'🏠', slots:2, moveCost:0, rent:1000, floor:'#6b5a8e', wall:'#4a3f68', grid:5, desc:'Humble beginnings. 2 desks.'},
  {id:'small', name:'Small Office', icon:'🏢', slots:4, moveCost:120000, rent:4000, floor:'#7a8ba6', wall:'#54627f', grid:6, desc:'Real office! 4 desks + plant.'},
  {id:'studio', name:'Game Studio', icon:'🏬', slots:6, moveCost:450000, rent:12000, floor:'#8a9a7b', wall:'#5d6b54', grid:7, desc:'Pro studio. 6 desks + lounge.'},
  {id:'hq', name:'Loft HQ', icon:'🌆', slots:8, moveCost:1100000, rent:30000, floor:'#a68a7a', wall:'#7a6355', grid:8, desc:'Dream HQ. 8 desks + arcade!'},
];
DT.RESEARCH = [
  {id:'engine2', name:'Engine: 2D+ Sprites', icon:'🧱', cost:15, kind:'engine', bonus:0.15, desc:'+15% quality on all games'},
  {id:'sound', name:'Sound Lab', icon:'🎵', cost:20, kind:'engine', bonus:0.15, desc:'+15% quality'},
  {id:'marketing1', name:'Magazine Ads', icon:'📰', cost:15, kind:'marketing', desc:'Unlock Magazine campaign'},
  {id:'demo', name:'Playable Demo', icon:'📀', cost:30, kind:'marketing', desc:'Unlock Demo campaign (+big hype)'},
  {id:'streamers', name:'Streamer Kits', icon:'📡', cost:60, kind:'marketing', desc:'Unlock Streamer campaign'},
  {id:'graphics3d', name:'3D Graphics', icon:'🧊', cost:60, kind:'engine', bonus:0.25, desc:'+25% quality. Unlocks Large games'},
  {id:'qa', name:'QA Process', icon:'🐞', cost:40, kind:'qa', desc:'Halves bugs produced'},
  {id:'aaa', name:'AAA Production', icon:'🏔️', cost:150, kind:'size', desc:'Unlocks AAA games'},
  {id:'training', name:'Training Courses', icon:'🎓', cost:35, kind:'training', desc:'Staff train 2× faster'},
];
DT.MARKETING = [
  {id:'mag', name:'Magazine Ad', icon:'📰', cost:10000, hype:15, need:null, desc:'Old school but works'},
  {id:'demo', name:'Playable Demo', icon:'📀', cost:30000, hype:35, need:'demo', desc:'Needs Playable Demo research'},
  {id:'stream', name:'Streamer Kits', icon:'📡', cost:80000, hype:60, need:'streamers', desc:'Needs Streamer Kits research'},
];
DT.FIRST_NAMES = ['Ada','Pixel','Rex','Mia','Leo','Zoe','Max','Ivy','Kai','Nia','Sam','Ori','Bea','Ash','Lou','Noa','Eli','June','Finn','Wren'];
DT.LAST_NAMES = ['Byte','Forge','Quest','Pixel','Debug','Sprite','Hex','Cache','Nova','Glitch','Loop','Render'];
DT.GAME_NAME_A = ['Pixel','Neon','Turbo','Mystic','Iron','Crimson','Quantum','Shadow','Golden','Cosmic','Retro','Thunder','Silent','Epic','Tiny','Dark','Star','Moon','Dragon','Ghost'];
DT.GAME_NAME_B = ['Quest','Legends','Drift','Empire','Frontier','Protocol','Saga','Strike','Realms','Voyage','Heist','Odyssey','Arena','Chronicles','Factory','Depths','Riders','Fables','Siege','Bloom'];
DT.REVIEWERS = [{n:'GamePro',i:'🎮'},{n:'PixelMag',i:'🕹️'},{n:'JoyStick',i:'👾'},{n:'StarPlay',i:'⭐'}];
DT.STAFF_ROLES = [
  {id:'dev', name:'Developer', icon:'🧑‍💻'}, {id:'design', name:'Designer', icon:'🎨'},
  {id:'artist', name:'Artist', icon:'🖌️'}, {id:'qa', name:'Tester', icon:'🐞'},
];
