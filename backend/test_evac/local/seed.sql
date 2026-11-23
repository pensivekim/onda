INSERT OR IGNORE INTO onda_users (id, name, role) VALUES
 ('H1','이장 김○○','responder'),('H2','주민 이○○','responder'),('H3','자율방재단 강○○','responder'),('H4','주민 정○○','responder'),
 ('O1','요양보호사 박○○','responder'),('O2','생활지원사 최○○','responder'),('O3','요양보호사 한○○','responder'),
 ('U_A','가상A','requester'),('gun_admin','군청 담당','admin');
INSERT OR IGNORE INTO onda_responders (user_id, grade, status, available) VALUES
 ('H1','green','approved',1),('H2','green','approved',1),('H3','green','approved',1),('H4','green','approved',1),
 ('O1','orange','approved',1),('O2','orange','approved',1),('O3','orange','approved',1);
INSERT OR IGNORE INTO onda_gov_contracts (id, gov_name, region, budget) VALUES ('G1','○○군','KR',3000000);
INSERT OR IGNORE INTO onda_gov_beneficiaries (id, contract_id, user_id, name) VALUES ('BEN_A','G1','U_A','가상A');
