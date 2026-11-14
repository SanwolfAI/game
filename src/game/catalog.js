// Expandable additional Durban vehicle catalogue. Original five models stay untouched.
const VEHICLES=[];
const COLORS=['#e7e7e2','#172b45','#b72f2b','#d4aa32','#526b54','#6c737c','#f4f4ef','#202329','#8b4b2e','#2d719d'];
function add(brand,models,shape,category='car',opts={}) {
 for(const model of models.split(';').map(x=>x.trim()).filter(Boolean)){
  const id=(brand+'-'+model).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const hash=[...id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
  VEHICLES.push({id,brand,model,name:brand+' '+model,shape,category,color:opts.color||COLORS[hash%COLORS.length],
   max:opts.max||(shape==='motorcycle'?68:shape==='bus'?38:shape==='bakkie'?48:56),
   boost:opts.boost||(shape==='motorcycle'?92:shape==='bus'?48:76),
   handling:opts.handling||(shape==='motorcycle'?2:shape==='bus'?.85:shape==='suv'?1.25:1.55),
   traffic:opts.traffic===true});
 }
}
// Hatchbacks, sedans, SUVs, sports cars and bakkies. Existing Quantum, Hilux, Polo Vivo, Gusheshe and SAPS are excluded.
add('Alfa Romeo','Giulia','sedan'); add('Alfa Romeo','Stelvio','suv');
add('Audi','A1','compact'); add('Audi','A3;A4;A5;A6;A7;A8','sedan'); add('Audi','Q2;Q3;Q5;Q7;Q8;e-tron','suv'); add('Audi','R8','sports');
add('BAIC','B30;B40 Plus;X55 Plus','suv');
add('BMW','1 Series;2 Series;3 Series;4 Series;5 Series;7 Series','sedan'); add('BMW','M3;M4;M5;Z4','sports'); add('BMW','X1;X2;X3;X4;X5;X6;X7;XM','suv');
add('Chery','Tiggo 4;Tiggo 7;Tiggo 8;Tiggo 9','suv'); add('Citroën','C3','compact'); add('Citroën','C3 Aircross','suv'); add('Fiat','500','compact');
add('Ford','Fiesta;Focus','compact'); add('Ford','Mustang','sports'); add('Ford','Everest;Territory','suv'); add('Ford','Ranger;Ranger Raptor','bakkie');
add('GWM','P300;P500','bakkie'); add('Haval','Jolion;H6;H7;H6 GT','suv');
add('Honda','Amaze;Civic;Fit','compact'); add('Honda','Civic Type R','sports'); add('Honda','CR-V;HR-V;Elevate','suv');
add('Hyundai','Grand i10;i20','compact'); add('Hyundai','Creta;Tucson;Santa Fe;Venue;Palisade','suv');
add('Isuzu','D-Max','bakkie'); add('Isuzu','mu-X','suv'); add('Jaguar','F-Type','sports'); add('Jaguar','F-Pace;E-Pace;I-Pace','suv');
add('Jeep','Wrangler','suv'); add('Jeep','Gladiator','bakkie'); add('Jetour','Dashing;T1;T2;X70 Plus','suv');
add('Kia','Picanto;Rio;Pegas','compact'); add('Kia','Seltos;Sonet;Sportage;Sorento;Carnival','suv');
add('Land Rover','Defender;Discovery;Range Rover;Evoque','suv'); add('Lexus','IS;ES;LS','sedan'); add('Lexus','RX;LX;NX;GX','suv');
add('Mahindra','Scorpio;Scorpio-N;XUV3XO;XUV700;Bolero','suv'); add('Mahindra','Pik Up','bakkie');
add('Mazda','Mazda2;Mazda3','compact'); add('Mazda','CX-3;CX-30;CX-5;CX-60','suv');
add('Mercedes-Benz','A-Class;C-Class;E-Class;S-Class;CLA','sedan'); add('Mercedes-Benz','GLA;GLC;GLE;G-Class','suv'); add('Mercedes-Benz','AMG GT','sports');
add('MG','MG3','compact'); add('MG','ZS;HS','suv'); add('MG','Cyberster','sports');
add('MINI','Cooper;Clubman','compact'); add('MINI','Countryman','suv');
add('Mitsubishi','ASX;Eclipse Cross;Outlander;Pajero Sport','suv'); add('Mitsubishi','Triton','bakkie');
add('Nissan','Magnite;Micra','compact'); add('Nissan','X-Trail;Patrol','suv'); add('Nissan','Navara','bakkie');
add('Omoda','C5;C7;C9','suv'); add('Jaecoo','J5;J7','suv'); add('Opel','Corsa','compact'); add('Opel','Mokka;Grandland','suv');
add('Peugeot','2008;3008;5008','suv'); add('Peugeot','Landtrek','bakkie'); add('Porsche','911;Cayman;Boxster','sports'); add('Porsche','Cayenne;Macan','suv'); add('Porsche','Panamera;Taycan','sedan');
add('Renault','Kwid;Kiger;Triber;Captur','compact'); add('Renault','Duster','suv');
add('Suzuki','Swift;Baleno;Celerio;S-Presso','compact'); add('Suzuki','Jimny;Fronx;Grand Vitara','suv'); add('Suzuki','Ertiga','van');
add('Tata','Tiago','compact'); add('Tata','Punch;Harrier;Curvv','suv');
add('Toyota','Corolla;Starlet;Vitz','compact'); add('Toyota','Corolla Cross;Fortuner;Land Cruiser;Prado;RAV4;Starlet Cross;Urban Cruiser','suv'); add('Toyota','86','sports');
add('Volkswagen','Polo;Golf GTI;Golf R','compact'); add('Volkswagen','Tiguan;T-Cross;T-Roc;Touareg','suv'); add('Volkswagen','Amarok','bakkie');
// Buses, commuter transport, taxis and coaches.
add('Toyota','HiAce','van','minibus',{traffic:true}); add('Toyota','Coaster','bus','bus',{traffic:true});
add('Mercedes-Benz','Sprinter','van','minibus',{traffic:true}); add('Mercedes-Benz','O500;Citaro','bus','bus',{traffic:true});
add('MAN',"Lion's City;Lion's Coach",'bus','bus'); add('Scania','Touring;Citywide','bus','bus'); add('Volvo','B7R;B9R','bus','bus');
add('Iveco','Daily Minibus','van','minibus'); add('Tata','Bus','bus','bus'); add('Isuzu','Bus','bus','bus'); add('Hino','Bus','bus','bus');
add('Yutong','City Bus','bus','bus'); add('King Long','Coach','bus','bus'); add('Higer','Bus','bus','bus'); add('Marcopolo','Coach','bus','bus'); add('Irizar','Coach','bus','bus'); add('Fuso','Rosa','bus','bus');
add('SA Taxi','16-Seater Minibus Taxi','van','taxi',{color:'#f4f0e6',traffic:true});
add('SA Bus','Metro Commuter Bus','bus','bus',{traffic:true}); add('SA Bus','Intercity Coach','bus','bus'); add('SA Bus','School Bus','bus','bus',{color:'#e7bd24'});
// Motorcycles: sport, adventure, cruiser, road and commuter.
add('BMW Motorrad','R1250 GS;R1300 GS;F900R;S1000RR','motorcycle','motorcycle');
add('Honda Motorcycle','Africa Twin;CBR1000RR;CB750;CRF300L','motorcycle','motorcycle');
add('Yamaha','R1;R7;MT-07;MT-09;Ténéré 700','motorcycle','motorcycle');
add('Kawasaki','Ninja 400;Ninja ZX-6R;ZX-10R;Z900','motorcycle','motorcycle');
add('Suzuki Motorcycle','GSX-R1000;GSX-S750;V-Strom','motorcycle','motorcycle');
add('KTM','Duke 390;Duke 790;RC 390;Adventure 890','motorcycle','motorcycle');
add('Harley-Davidson','Street Bob;Sportster;Fat Boy;Road King','motorcycle','motorcycle');
add('Triumph','Bonneville;Trident 660;Street Triple;Tiger 900','motorcycle','motorcycle');
add('Ducati','Panigale V4;Monster;Multistrada;Scrambler','motorcycle','motorcycle');
add('Royal Enfield','Classic 350;Himalayan;Meteor 350','motorcycle','motorcycle');
add('CFMOTO','450SR;450MT;800MT','motorcycle','motorcycle'); add('Husqvarna','Svartpilen;Vitpilen;Norden 901','motorcycle','motorcycle');
add('Big Boy','Commuter 125;Commuter 150;Urban Scooter','motorcycle','motorcycle');
export const EXTRA_VEHICLES=VEHICLES;
