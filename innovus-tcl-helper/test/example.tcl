# addInst -cell AND2X1 -inst my_and1 -loc {100 200} -ori R0 -place_status placed

# addNet -net my_net -pins {my_and1/A my_or1/Y}

# checkDesign -all

# report_timing -delay_type max -nworst 10

# setPlaceMode -congEffort high

# routeDesign -globalDetail

# verify_drc

# saveDesign my_design.enc
