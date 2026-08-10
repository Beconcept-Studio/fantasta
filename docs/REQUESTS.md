### Registrazione con email
Voglio implementare la possibilità di registrarsi con email e password.
Voglio un processo di registrazione e login semplice.
Voglio che durante la registrazione venga inserito il controllo della email (inviamo una email con codice) da inserire nello step successivo. Se corretto verifica la email e permette il login.

### Pannello di controllo super admin
Gli utenti super admin (con is_admin flaggato) devono poter vedere in navbar un bottone "Admin" che porta alla parte di amministrazione dell'app.
Al momento mi interessa vedere da questa nuova sezione la lista degli utenti, e poterli gestire (cambio info, status, verifica manuale della email, le solite cose). Valutare quando si mette un utente in stop (quindi non può fare login), di mettere in pausa tutte le sue aste.
Un'altra sezione che voglio vedere è la lista delle aste, con dato di chi l'ha creata (email) e possibilità di cancellarla da Database, cancellando tutto ciò che è collegato (non l'utente chiaramente).
Prevedi quindi una navigazione ad hoc per questo pannello. Puoi inserire una sidebar apposita.