-- Remover coluna inserido_manualmente (passámos a usar origem_instancia = 'dashboardAdm' para leads inseridos manualmente).
-- Seguro para executar mesmo que a coluna não exista (MySQL 5.7+).

DROP PROCEDURE IF EXISTS drop_inserido_manualmente_if_exists;
DELIMITER ;;
CREATE PROCEDURE drop_inserido_manualmente_if_exists()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ch_leads' AND COLUMN_NAME = 'inserido_manualmente'
  ) THEN
    ALTER TABLE ch_leads DROP COLUMN inserido_manualmente;
  END IF;
END;;
DELIMITER ;
CALL drop_inserido_manualmente_if_exists();
DROP PROCEDURE IF EXISTS drop_inserido_manualmente_if_exists;
