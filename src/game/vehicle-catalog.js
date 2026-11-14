// Expandable Durban / South African vehicle catalogue.
// Existing models are deliberately kept in models.js and are not repeated here.
const rows = [
  // Cars, hatchbacks, sedans, performance cars and SUVs
  ["Alfa Romeo","Giulia","car"],["Alfa Romeo","Stelvio","suv"],
  ["Audi","A1","hatch"],["Audi","A3","car"],["Audi","A4","car"],["Audi","A5","car"],["Audi","A6","car"],["Audi","A7","car"],["Audi","A8","car"],["Audi","Q2","suv"],["Audi","Q3","suv"],["Audi","Q5","suv"],["Audi","Q7","suv"],["Audi","Q8","suv"],["Audi","R8","sport"],["Audi","e-tron","suv"],
  ["BAIC","B30","suv"],["BAIC","B40 Plus","suv"],["BAIC","X55 Plus","suv"],
  ["BMW","1 Series","hatch"],["BMW","2 Series","car"],["BMW","3 Series","car"],["BMW","4 Series","sport"],["BMW","5 Series","car"],["BMW","7 Series","luxury"],["BMW","M3","sport"],["BMW","M4","sport"],["BMW","M5","sport"],["BMW","X1","suv"],["BMW","X2","suv"],["BMW","X3","suv"],["BMW","X4","suv"],["BMW","X5","suv"],["BMW","X6","suv"],["BMW","X7","suv"],["BMW","XM","suv"],["BMW","Z4","sport"],
  ["Chery","Tiggo 4","suv"],["Chery","Tiggo 7","suv"],["Chery","Tiggo 8","suv"],["Chery","Tiggo 9","suv"],
  ["Citroën","C3","hatch"],["Citroën","C3 Aircross","suv"],["Fiat","500","hatch"],
  ["Ford","Fiesta","hatch"],["Ford","Focus","hatch"],["Ford","Mustang","sport"],["Ford","Everest","suv"],["Ford","Ranger","pickup"],["Ford","Ranger Raptor","pickup"],["Ford","Territory","suv"],
  ["GWM","P300","pickup"],["GWM","P500","pickup"],["Haval","Jolion","suv"],["Haval","H6","suv"],["Haval","H7","suv"],["Haval","H6 GT","suv"],
  ["Honda","Amaze","car"],["Honda","Civic","car"],["Honda","Civic Type R","sport"],["Honda","CR-V","suv"],["Honda","Fit","hatch"],["Honda","HR-V","suv"],["Honda","Elevate","suv"],
  ["Hyundai","Grand i10","hatch"],["Hyundai","i20","hatch"],["Hyundai","Creta","suv"],["Hyundai","Tucson","suv"],["Hyundai","Santa Fe","suv"],["Hyundai","Venue","suv"],["Hyundai","Palisade","suv"],
  ["Isuzu","D-Max","pickup"],["Isuzu","mu-X","suv"],["Jaguar","F-Type","sport"],["Jaguar","F-Pace","suv"],["Jaguar","E-Pace","suv"],["Jaguar","I-Pace","suv"],
  ["Jeep","Wrangler","suv"],["Jeep","Gladiator","pickup"],["Jetour","Dashing","suv"],["Jetour","T1","suv"],["Jetour","T2","suv"],["Jetour","X70 Plus","suv"],
  ["Kia","Picanto","hatch"],["Kia","Rio","hatch"],["Kia","Pegas","car"],["Kia","Seltos","suv"],["Kia","Sonet","suv"],["Kia","Sportage","suv"],["Kia","Sorento","suv"],["Kia","Carnival","van"],
  ["Land Rover","Defender","suv"],["Land Rover","Discovery","suv"],["Land Rover","Range Rover","luxury"],["Land Rover","Evoque","suv"],
  ["Lexus","IS","car"],["Lexus","ES","luxury"],["Lexus","LS","luxury"],["Lexus","RX","suv"],["Lexus","LX","suv"],["Lexus","NX","suv"],["Lexus","GX","suv"],
  ["Mahindra","Scorpio","suv"],["Mahindra","Scorpio-N","suv"],["Mahindra","Pik Up","pickup"],["Mahindra","XUV3XO","suv"],["Mahindra","XUV700","suv"],["Mahindra","Bolero","suv"],
  ["Mazda","Mazda2","hatch"],["Mazda","Mazda3","hatch"],["Mazda","CX-3","suv"],["Mazda","CX-30","suv"],["Mazda","CX-5","suv"],["Mazda","CX-60","suv"],
  ["Mercedes-Benz","A-Class","hatch"],["Mercedes-Benz","C-Class","car"],["Mercedes-Benz","E-Class","luxury"],["Mercedes-Benz","S-Class","luxury"],["Mercedes-Benz","CLA","car"],["Mercedes-Benz","GLA","suv"],["Mercedes-Benz","GLC","suv"],["Mercedes-Benz","GLE","suv"],["Mercedes-Benz","G-Class","suv"],["Mercedes-Benz","AMG GT","sport"],
  ["MG","MG3","hatch"],["MG","ZS","suv"],["MG","HS","suv"],["MG","Cyberster","sport"],["MINI","Cooper","hatch"],["MINI","Countryman","suv"],["MINI","Clubman","hatch"],
  ["Mitsubishi","ASX","suv"],["Mitsubishi","Eclipse Cross","suv"],["Mitsubishi","Outlander","suv"],["Mitsubishi","Pajero Sport","suv"],["Mitsubishi","Triton","pickup"],
  ["Nissan","Magnite","suv"],["Nissan","Micra","hatch"],["Nissan","X-Trail","suv"],["Nissan","Navara","pickup"],["Nissan","Patrol","suv"],
  ["Omoda","C5","suv"],["Omoda","C7","suv"],["Omoda","C9","suv"],["Jaecoo","J5","suv"],["Jaecoo","J7","suv"],
  ["Opel","Corsa","hatch"],["Opel","Mokka","suv"],["Opel","Grandland","suv"],["Peugeot","2008","suv"],["Peugeot","3008","suv"],["Peugeot","5008","suv"],["Peugeot","Landtrek","pickup"],
  ["Porsche","911","sport"],["Porsche","Cayenne","suv"],["Porsche","Macan","suv"],["Porsche","Panamera","luxury"],["Porsche","Taycan","sport"],["Porsche","Cayman","sport"],["Porsche","Boxster","sport"],
  ["Renault","Kwid","hatch"],["Renault","Kiger","suv"],["Renault","Duster","suv"],["Renault","Triber","van"],["Renault","Captur","suv"],
  ["Suzuki","Swift","hatch"],["Suzuki","Baleno","hatch"],["Suzuki","Celerio","hatch"],["Suzuki","Jimny","suv"],["Suzuki","Fronx","suv"],["Suzuki","Ertiga","van"],["Suzuki","Grand Vitara","suv"],["Suzuki","S-Presso","hatch"],
  ["Tata","Tiago","hatch"],["Tata","Punch","suv"],["Tata","Harrier","suv"],["Tata","Curvv","suv"],
  ["Toyota","Corolla","car"],["Toyota","Corolla Cross","suv"],["Toyota","Fortuner","suv"],["Toyota","Land Cruiser","suv"],["Toyota","Prado","suv"],["Toyota","RAV4","suv"],["Toyota","Starlet","hatch"],["Toyota","Starlet Cross","suv"],["Toyota","Urban Cruiser","suv"],["Toyota","Vitz","hatch"],["Toyota","86","sport"],
  ["Volkswagen","Polo","hatch"],["Volkswagen","Golf GTI","sport"],["Volkswagen","Golf R","sport"],["Volkswagen","Tiguan","suv"],["Volkswagen","T-Cross","suv"],["Volkswagen","T-Roc","suv"],["Volkswagen","Touareg","suv"],["Volkswagen","Amarok","pickup"],
  // Buses, minibuses, coaches, taxis and service vehicles
  ["Toyota","HiAce","minibus"],["Toyota","Coaster","bus"],["Mercedes-Benz","Sprinter","minibus"],["Mercedes-Benz","O500","bus"],["Mercedes-Benz","Citaro","bus"],["MAN","Lion's City","bus"],["MAN","Lion's Coach","coach"],["Scania","Touring","coach"],["Scania","Citywide","bus"],["Volvo","B7R Coach","coach"],["Volvo","B9R Coach","coach"],["Iveco","Daily Minibus","minibus"],["Tata","Commuter Bus","bus"],["Isuzu","N-Series Bus","bus"],["Hino","Commuter Bus","bus"],["Yutong","City Bus","bus"],["King Long","Coach","coach"],["Higer","Coach","coach"],["Marcopolo","Coach","coach"],["Irizar","Coach","coach"],["Fuso","Rosa","minibus"],["South African Taxi","Toyota HiAce Taxi","taxi"],["South African Taxi","Sprinter Taxi","taxi"],["South African Taxi","Midibus Taxi","minibus"],["School Transport","School Bus","bus"],
  // Motorcycles and scooters
  ["BMW Motorrad","R1250 GS","motorcycle"],["BMW Motorrad","R1300 GS","motorcycle"],["BMW Motorrad","S1000RR","sportbike"],["BMW Motorrad","F900R","motorcycle"],
  ["Honda","Africa Twin","motorcycle"],["Honda","CBR1000RR","sportbike"],["Honda","CB750","motorcycle"],["Honda","CRF300L","motorcycle"],
  ["Yamaha","R1","sportbike"],["Yamaha","R7","sportbike"],["Yamaha","MT-07","motorcycle"],["Yamaha","MT-09","motorcycle"],["Yamaha","Ténéré 700","motorcycle"],
  ["Kawasaki","Ninja 400","sportbike"],["Kawasaki","Ninja ZX-6R","sportbike"],["Kawasaki","ZX-10R","sportbike"],["Kawasaki","Z900","motorcycle"],
  ["Suzuki","GSX-R1000","sportbike"],["Suzuki","GSX-S750","motorcycle"],["Suzuki","V-Strom","motorcycle"],
  ["KTM","Duke 390","motorcycle"],["KTM","Duke 790","motorcycle"],["KTM","RC 390","sportbike"],["KTM","Adventure 890","motorcycle"],
  ["Harley-Davidson","Street Bob","cruiser"],["Harley-Davidson","Sportster","cruiser"],["Harley-Davidson","Fat Boy","cruiser"],["Harley-Davidson","Road King","cruiser"],
  ["Triumph","Bonneville","cruiser"],["Triumph","Trident 660","motorcycle"],["Triumph","Street Triple","motorcycle"],["Triumph","Tiger 900","motorcycle"],
  ["Ducati","Panigale V4","sportbike"],["Ducati","Monster","motorcycle"],["Ducati","Multistrada","motorcycle"],["Ducati","Scrambler","motorcycle"],
  ["Royal Enfield","Classic 350","cruiser"],["Royal Enfield","Himalayan","motorcycle"],["Royal Enfield","Meteor 350","cruiser"],
  ["CFMOTO","450SR","sportbike"],["CFMOTO","450MT","motorcycle"],["CFMOTO","800MT","motorcycle"],
  ["Husqvarna","Svartpilen","motorcycle"],["Husqvarna","Vitpilen","motorcycle"],["Husqvarna","Norden 901","motorcycle"],
  ["Big Boy","Commuter 150","motorcycle"],["Big Boy","Scooter 125","scooter"]
];

const palette = ["#e53935","#f2f2ee","#20252b","#1f65a8","#d6b42d","#477c55","#777d86","#8b3f91","#d97932"];
const slug = (value) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const EXPANSION_TYPES = rows.map(([brand, model, kind], index) => ({
  id: "extra-" + slug(brand) + "-" + slug(model),
  name: brand + " " + model,
  brand,
  model,
  kind,
  color: palette[index % palette.length],
  max: kind === "sportbike" || kind === "sport" ? 68 : kind === "bus" || kind === "coach" ? 38 : kind === "motorcycle" || kind === "scooter" || kind === "cruiser" ? 58 : kind === "pickup" || kind === "suv" ? 46 : 52,
  boost: kind === "sportbike" || kind === "sport" ? 92 : kind === "bus" || kind === "coach" ? 48 : 70,
  handling: kind === "sportbike" || kind === "sport" ? 1.9 : kind === "bus" || kind === "coach" ? 1.0 : kind === "motorcycle" || kind === "scooter" || kind === "cruiser" ? 1.65 : 1.45
}));
