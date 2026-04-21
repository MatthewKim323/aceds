# unified.csv audit

Total rows: **104,549**  

`n_letter == 0`: **21,568** (20.6%)  
`avgGPA == 0`: **21,850** (20.9%)  
Both: **21,568** (these are the drop-for-training rows)


After filter `n_letter > 5`: **74,487** rows (kept 71.2%).

Strict training set (confidence in exact_initial/only_candidate): **62,454** rows (59.7%).


## RMP confidence breakdown

| confidence | all rows | n_letter>5 rows |
|---|---:|---:|
| exact_initial | 77,996 | 57,175 |
| only_candidate | 7,290 | 5,279 |
| top_by_ratings | 5,554 | 3,723 |
| none | 13,709 | 8,310 |

## Rows by year

| year | rows |
|---:|---:|
| 2009 | 1,091 |
| 2010 | 4,289 |
| 2011 | 5,240 |
| 2012 | 6,041 |
| 2013 | 6,072 |
| 2014 | 6,166 |
| 2015 | 6,132 |
| 2016 | 6,086 |
| 2017 | 6,317 |
| 2018 | 8,726 |
| 2019 | 13,537 |
| 2020 | 6,408 |
| 2021 | 5,793 |
| 2022 | 5,485 |
| 2023 | 5,422 |
| 2024 | 5,375 |
| 2025 | 5,091 |
| 2026 | 1,278 |

## Last 12 quarters (train/test horizon)

| year | quarter | rows |
|---:|---|---:|
| 2023 | Spring | 1,553 |
| 2023 | Summer | 629 |
| 2023 | Fall | 1,583 |
| 2024 | Winter | 1,608 |
| 2024 | Spring | 1,547 |
| 2024 | Summer | 620 |
| 2024 | Fall | 1,600 |
| 2025 | Winter | 1,635 |
| 2025 | Spring | 1,555 |
| 2025 | Summer | 630 |
| 2025 | Fall | 1,271 |
| 2026 | Winter | 1,278 |

## Top 20 departments by row count

| dept | rows |
|---|---:|
| ED | 4,803 |
| WRIT | 4,391 |
| MUS | 4,138 |
| MATH | 3,415 |
| ECON | 3,393 |
| CHEM | 3,270 |
| MCDB | 3,142 |
| PHYS | 3,068 |
| EEMB | 2,991 |
| PSY | 2,964 |
| INT | 2,868 |
| HIST | 2,866 |
| ECE | 2,808 |
| ES | 2,720 |
| ENGL | 2,625 |
| SOC | 2,494 |
| CMPSC | 2,402 |
| RG | 2,266 |
| COMM | 2,244 |
| CH | 2,157 |

## Spring 2026 catalog join

- rows with catalog columns populated: **8,912**
- unique courses: **797**


## Spot-check: 20 random top_by_ratings rows

| instructor_norm   | dept   |   rmp_rating |   rmp_difficulty |   rmp_num_ratings | rmp_department         |
|:------------------|:-------|-------------:|-----------------:|------------------:|:-----------------------|
| MORA E G          | ED     |          4.1 |              2   |                90 | Classics               |
| CHRISTOPHER P     | CH     |          4.3 |              2.5 |                74 | Ethnic Studies         |
| NGUYEN D          | MATH   |          1.2 |              3.9 |                83 | Biology                |
| JACKSON Z I       | BL     |          4.5 |              2.1 |                73 | Geology                |
| HARRIS O          | THTR   |          2.5 |              2.9 |                51 | Science                |
| SCHNEIDER B E     | INT    |          3.8 |              2.8 |                31 | Economics              |
| CHRONOPOULOU      | PSTAT  |          2.8 |              3.4 |                32 | Mathematics            |
| BENJAMIN R        | INT    |          3.2 |              3.3 |                39 | Asian American Studies |
| GORDON D E        | MAT    |          3.3 |              2   |               111 | Sociology              |
| BLOCK J H         | ED     |          0   |              0   |                 0 | Engineering            |
| BRADLEY N D       | WRIT   |          4.8 |              1.9 |                48 | Writing                |
| HSU C-C           | CHIN   |          3.3 |              3.1 |                43 | Statistics             |
| VAN DER VEN A     | MATRL  |          4.1 |              3.3 |               248 | Chemistry              |
| SU J              | CMPSC  |          3.7 |              3.2 |                39 | Economics              |
| MEYER M N         | ED     |          2.8 |              4.1 |                12 | Political Science      |
| EL OMARI R M      | RG     |          2.8 |              3.7 |               114 | History                |
| DAVIS M J         | ES     |          4.1 |              2.1 |                21 | English                |
| VAN DE WALLE      | MATRL  |          4.1 |              3.3 |               248 | Chemistry              |
| CLEMENT R J       | MATRL  |          4.3 |              3.7 |                 6 | Economics              |
| ROBINSON T        | ES     |          3.4 |              3.2 |               140 | Sociology              |